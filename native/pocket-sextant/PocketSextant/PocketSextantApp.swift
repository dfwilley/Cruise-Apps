import SwiftUI

@main
struct PocketSextantApp: App {
    var body: some Scene {
        WindowGroup {
            SextantView().ignoresSafeArea(.container, edges: .bottom)
                .background(Color(red: 11/255, green: 29/255, blue: 51/255).ignoresSafeArea())
        }
    }
}
