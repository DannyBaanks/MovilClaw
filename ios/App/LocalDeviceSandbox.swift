import Foundation

/// Resultado de una ejecución o herramienta en el sandbox local del iPhone.
public struct ToolResult: Codable {
    public let success: Bool
    public let output: String
    public let error: String?
    public let code: Int
    public let durationMs: Double

    public init(success: Bool, output: String, error: String? = nil, code: Int = 0, durationMs: Double = 0) {
        self.success = success
        self.output = output
        self.error = error
        self.code = code
        self.durationMs = durationMs
    }
}

/// Estado de permisos para operaciones sobre el sandbox del dispositivo.
public enum SandboxApproval: String, Codable {
    case allowOnce
    case allowAlways
    case reject
}

/// Sandbox local en el iPhone: gestiona el espacio de trabajo aislado en Documents/MovilClaw/work/app.
///
/// Invariante de seguridad:
/// 1. Ninguna ruta puede salir del directorio `/work/app`.
/// 2. No se tiene acceso a Keychain, credenciales del sistema ni archivos de otras apps.
/// 3. Límite de tamaño: archivos de hasta 1 MB para escritura y truncado de lectura a 200 KB.
public actor LocalDeviceSandbox {
    public static let shared = LocalDeviceSandbox()
    
    private let fileManager = FileManager.default
    private let workspaceURL: URL
    
    public init() {
        let docs = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.workspaceURL = docs.appendingPathComponent("MovilClaw/work/app", isDirectory: true)
        try? fileManager.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
    }

    /// Valida que la ruta sea relativa y no intente escapar con '..' o prefijos absolutos.
    public func resolveSafePath(_ relativePath: String) throws -> URL {
        let clean = relativePath.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty || clean == "." {
            return workspaceURL
        }
        if clean.hasPrefix("/") || clean.contains("..") || clean.contains("\0") || clean.contains("\n") || clean.contains("\r") {
            throw NSError(domain: "MovilClawSandbox", code: 403, userInfo: [
                NSLocalizedDescriptionKey: "DENY: La ruta debe ser relativa y mantenerse estrictamente dentro del workspace."
            ])
        }
        let target = workspaceURL.appendingPathComponent(clean).standardizedFileURL
        guard target.path.hasPrefix(workspaceURL.path) else {
            throw NSError(domain: "MovilClawSandbox", code: 403, userInfo: [
                NSLocalizedDescriptionKey: "DENY: Intento de escape de directorio detectado."
            ])
        }
        return target
    }

    /// Lee el contenido de un archivo dentro del workspace.
    public func readFile(path: String) throws -> String {
        let fileURL = try resolveSafePath(path)
        guard fileManager.fileExists(atPath: fileURL.path) else {
            throw NSError(domain: "MovilClawSandbox", code: 404, userInfo: [
                NSLocalizedDescriptionKey: "No se encuentra el archivo: \(path)"
            ])
        }
        let data = try Data(contentsOf: fileURL)
        if data.count > 10_000_000 {
            throw NSError(domain: "MovilClawSandbox", code: 413, userInfo: [
                NSLocalizedDescriptionKey: "El archivo supera el límite de 10 MB."
            ])
        }
        let text = String(decoding: data, as: UTF8.self)
        return text.count > 200_000 ? String(text.prefix(200_000)) + "\n...[truncado]" : text
    }

    /// Escribe contenido en un archivo dentro del workspace (creando subdirectorios si es necesario).
    public func writeFile(path: String, content: String) throws -> Int {
        guard content.utf8.count <= 1_000_000 else {
            throw NSError(domain: "MovilClawSandbox", code: 413, userInfo: [
                NSLocalizedDescriptionKey: "El contenido supera el límite de 1 MB."
            ])
        }
        let fileURL = try resolveSafePath(path)
        let parentDir = fileURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
        let data = Data(content.utf8)
        try data.write(to: fileURL, options: .atomic)
        return data.count
    }

    /// Edita un archivo reemplazando una coincidencia exacta y única.
    public func editFile(path: String, from: String, to: String) throws -> Int {
        let current = try readFile(path: path)
        let parts = current.components(separatedBy: from)
        let occurrences = parts.count - 1
        if occurrences == 0 {
            throw NSError(domain: "MovilClawSandbox", code: 400, userInfo: [
                NSLocalizedDescriptionKey: "El texto a reemplazar no existe en el archivo."
            ])
        }
        if occurrences > 1 {
            throw NSError(domain: "MovilClawSandbox", code: 400, userInfo: [
                NSLocalizedDescriptionKey: "El texto aparece \(occurrences) veces. Añade más contexto único."
            ])
        }
        let updated = current.replacingOccurrences(of: from, with: to)
        _ = try writeFile(path: path, content: updated)
        return 1
    }

    /// Lista los archivos del workspace.
    public func listFiles(subPath: String = ".") throws -> [String] {
        let dirURL = try resolveSafePath(subPath)
        guard let enumerator = fileManager.enumerator(at: dirURL, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else {
            return []
        }
        var files: [String] = []
        for case let fileURL as URL in enumerator {
            let relative = fileURL.path.replacingOccurrences(of: workspaceURL.path + "/", with: "")
            files.append(relative)
            if files.count >= 200 { break }
        }
        return files
    }

    /// Limpia el workspace local por completo.
    public func resetWorkspace() throws {
        if fileManager.fileExists(atPath: workspaceURL.path) {
            try fileManager.removeItem(at: workspaceURL)
        }
        try fileManager.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
    }

    public var rootPath: String {
        workspaceURL.path
    }
}
