import SwiftUI

@main
struct FjordSpotterApp: App {
    var body: some Scene {
        WindowGroup {
            SpotterView()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
        }
    }
}
