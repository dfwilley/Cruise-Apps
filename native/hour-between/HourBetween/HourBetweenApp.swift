import SwiftUI

@main
struct HourBetweenApp: App {
    var body: some Scene {
        WindowGroup {
            PlannerView().ignoresSafeArea(.container, edges: .bottom)
        }
    }
}
