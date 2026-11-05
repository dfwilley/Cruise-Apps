import SwiftUI
import WebKit
import CoreLocation

/// Shows the Arctic Night screens (bundled with the app, so they work offline) and answers their requests:
/// fetch data, get GPS, schedule alerts, send a test alert.
struct WebContainer: UIViewRepresentable {
    var previewNow: String?

    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(context.coordinator, name: "arctic")
        cfg.websiteDataStore = .default()
        let web = WKWebView(frame: .zero, configuration: cfg)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 6/255, green: 11/255, blue: 22/255, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.accessibilityIdentifier = "arcticWeb"
        context.coordinator.web = web
        if let dir = Bundle.main.url(forResource: "aurora-watch", withExtension: nil) {
            var index = dir.appendingPathComponent("index.html")
            if let p = previewNow, var comps = URLComponents(url: index, resolvingAgainstBaseURL: false) {
                comps.queryItems = [URLQueryItem(name: "now", value: p)]; index = comps.url ?? index
            }
            web.loadFileURL(index, allowingReadAccessTo: dir)
        }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Bridge: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {
        weak var web: WKWebView?
        private let loc = CLLocationManager()
        private var locWaiters: [Int] = []

        override init() { super.init(); loc.delegate = self; loc.desiredAccuracy = kCLLocationAccuracyKilometer }

        func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let m = message.body as? [String: Any], let id = m["id"] as? Int, let cmd = m["cmd"] as? String else { return }
            switch cmd {
            case "fetch":
                guard let s = m["url"] as? String, let url = URL(string: s) else { return reply(id, false, "bad url") }
                Task {
                    do {
                        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
                        req.setValue("ArcticNight/1.0 (personal aurora app)", forHTTPHeaderField: "User-Agent")
                        let (data, resp) = try await URLSession.shared.data(for: req)
                        if let h = resp as? HTTPURLResponse, h.statusCode >= 400 { return reply(id, false, "HTTP \(h.statusCode)") }
                        reply(id, true, String(decoding: data, as: UTF8.self))
                    } catch { reply(id, false, error.localizedDescription) }
                }
            case "location":
                locWaiters.append(id)
                if loc.authorizationStatus == .notDetermined { loc.requestWhenInUseAuthorization() } else { loc.requestLocation() }
            case "schedule":
                let alerts = (try? JSONSerialization.data(withJSONObject: m["alerts"] ?? [])).flatMap { try? JSONDecoder().decode([Notifier.Planned].self, from: $0) } ?? []
                if let live = m["live"], let d = try? JSONSerialization.data(withJSONObject: live),
                   let cfg = try? JSONDecoder().decode(LiveCheck.Config.self, from: d) {
                    LiveCheck.save(cfg)
                    if cfg.enabled { Notifier.scheduleLiveRefresh() }
                }
                Task {
                    if !alerts.isEmpty || (LiveCheck.loadConfig()?.enabled ?? false) { _ = await Notifier.requestPermission() }
                    await Notifier.replacePlanned(alerts)
                    reply(id, true, "\(alerts.count)")
                }
            case "test":
                Task {
                    guard await Notifier.requestPermission() else { return reply(id, false, "not allowed") }
                    await Notifier.post(id: "test-\(Date().timeIntervalSince1970)", title: "Arctic Night test alert", body: "Alerts are working. On a promising night you'll get one like this before the best time.", after: 5)
                    reply(id, true, "ok")
                }
            default:
                reply(id, false, "unknown command")
            }
        }

        private func reply(_ id: Int, _ ok: Bool, _ payload: String) {
            // Pass the payload as a JSON string literal so any characters are safe.
            let lit = (try? String(data: JSONSerialization.data(withJSONObject: [payload]), encoding: .utf8)).map { String($0.dropFirst().dropLast()) } ?? "\"\""
            DispatchQueue.main.async { self.web?.evaluateJavaScript("window.__arcticReply(\(id), \(ok), \(lit))") }
        }

        // MARK: Location
        func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
            switch m.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: if !locWaiters.isEmpty { m.requestLocation() }
            case .denied, .restricted: flushLocation(nil)
            default: break
            }
        }
        func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) { flushLocation(locs.last) }
        func locationManager(_ m: CLLocationManager, didFailWithError error: Error) { flushLocation(nil) }
        private func flushLocation(_ l: CLLocation?) {
            let ids = locWaiters; locWaiters.removeAll()
            for id in ids {
                if let l { reply(id, true, "{\"lat\":\(l.coordinate.latitude),\"lon\":\(l.coordinate.longitude)}") }
                else { reply(id, false, "location unavailable") }
            }
        }
    }
}
