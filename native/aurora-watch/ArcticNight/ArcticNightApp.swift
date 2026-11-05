import SwiftUI
import UserNotifications
import BackgroundTasks

@main
struct ArcticNightApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            WebContainer(previewNow: AppDelegate.previewNow)
                .ignoresSafeArea()
                .background(Color(red: 6/255, green: 11/255, blue: 22/255))
                .preferredColorScheme(.dark)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// `-previewNow 2027-01-30T21:30:00Z` previews the trip (used by the screenshot test).
    static var previewNow: String? {
        let a = ProcessInfo.processInfo.arguments
        if let i = a.firstIndex(of: "-previewNow"), i + 1 < a.count { return a[i + 1] }
        return nil
    }

    func application(_ app: UIApplication, didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Notifier.liveTaskID, using: nil) { task in
            Notifier.scheduleLiveRefresh() // keep the chain going
            let work = Task { await LiveCheck.run(); task.setTaskCompleted(success: true) }
            task.expirationHandler = { work.cancel() }
        }
        return true
    }

    // Show alerts even while the app is open.
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }
}
