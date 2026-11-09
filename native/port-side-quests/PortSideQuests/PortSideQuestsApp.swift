import SwiftUI

@main
struct PortSideQuestsApp: App {
    var body: some Scene {
        WindowGroup {
            QuestView().ignoresSafeArea(.container, edges: .bottom)
        }
    }
}
