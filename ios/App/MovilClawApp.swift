import SwiftUI

@main
struct MovilClawApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .background(Color(red: 0.03, green: 0.05, blue: 0.08).ignoresSafeArea())
        }
    }
}
