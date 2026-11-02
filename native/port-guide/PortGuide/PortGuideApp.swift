import SwiftUI

@main
struct PortGuideApp: App {
    var body: some Scene {
        WindowGroup {
            GuideView()
                .ignoresSafeArea()
        }
    }
}
