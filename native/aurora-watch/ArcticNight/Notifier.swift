import Foundation
import UserNotifications
import BackgroundTasks

/// Alerts scheduled on the phone, so they fire even without internet.
enum Notifier {
    static let liveTaskID = "com.dfwilley.arcticnight.live"

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func post(id: String, title: String, body: String, after seconds: TimeInterval) async {
        let c = UNMutableNotificationContent()
        c.title = title; c.body = body; c.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false)
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: trigger))
    }

    struct Planned: Codable { let id: String; let at: Double; let title: String; let body: String }

    /// Replaces all planned night alerts with a new list (at = ms since 1970).
    static func replacePlanned(_ list: [Planned]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("night-") })
        guard !list.isEmpty, await requestPermission() else { return }
        let now = Date().timeIntervalSince1970
        for a in list.prefix(40) where a.at / 1000 > now + 5 {
            await post(id: a.id, title: a.title, body: a.body, after: a.at / 1000 - now)
        }
    }

    static func scheduleLiveRefresh() {
        let req = BGAppRefreshTaskRequest(identifier: liveTaskID)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 20 * 60)
        try? BGTaskScheduler.shared.submit(req)
    }
}
