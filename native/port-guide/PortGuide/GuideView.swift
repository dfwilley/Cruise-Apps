import SwiftUI
import WebKit
import CoreLocation
import AVFoundation
import UserNotifications

/// The Port Pocket Guide screens, bundled inside the app so they work ashore with no signal.
/// The screens ask this side for: "locate" (one GPS fix), "alerts" (all-aboard reminders), "speak" (say a phrase)
/// and "saveCruises" (a backup copy of the cruises you added, handed back to the screens at every launch).
/// Links to Apple Maps and websites open outside the app.
struct GuideView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> GuideController { GuideController() }
    func updateUIViewController(_ vc: GuideController, context: Context) {}
}

final class GuideController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, CLLocationManagerDelegate {
    private var web: WKWebView!
    private let loc = CLLocationManager()
    private let voice = AVSpeechSynthesizer()
    private var wantFix = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 15/255, green: 34/255, blue: 54/255, alpha: 1)
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(WeakHandler(self), name: "port")
        // Cruises you added: give the screens the saved copy before they start, in case the web storage was cleared.
        if let d = try? Data(contentsOf: Self.cruisesFile), let json = String(data: d, encoding: .utf8),
           let lit = try? JSONSerialization.data(withJSONObject: [json], options: [.fragmentsAllowed]), let arr = String(data: lit, encoding: .utf8) {
            cfg.userContentController.addUserScript(WKUserScript(source: "window.__savedCruises = \(arr)[0];", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 246/255, green: 241/255, blue: 231/255, alpha: 1)
        web.accessibilityIdentifier = "guideWeb"
        view.addSubview(web)
        if let dir = Bundle.main.url(forResource: "port-guide", withExtension: nil) {
            var page = dir.appendingPathComponent("index.html")
            // UI tests pass -previewNow to show a port day.
            if let i = CommandLine.arguments.firstIndex(of: "-previewNow"), i + 1 < CommandLine.arguments.count,
               var c = URLComponents(url: page, resolvingAgainstBaseURL: false) {
                c.queryItems = [URLQueryItem(name: "now", value: CommandLine.arguments[i + 1])]
                page = c.url ?? page
            }
            web.loadFileURL(page, allowingReadAccessTo: dir)
        }
        loc.delegate = self
        loc.desiredAccuracy = kCLLocationAccuracyBest
    }

    // MARK: Messages from the screens
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let cmd = m["cmd"] as? String else { return }
        switch cmd {
        case "locate": locate()
        case "alerts": schedule((m["items"] as? [[String: Any]]) ?? [])
        case "speak": speak(m["text"] as? String ?? "", lang: m["lang"] as? String ?? "nb-NO")
        case "viking": openViking(m["url"] as? String)
        case "saveCruises": if let j = m["json"] as? String { try? Data(j.utf8).write(to: Self.cruisesFile, options: .atomic) }
        default: break
        }
    }

    // MARK: Viking's website, to read a cruise itinerary
    private func openViking(_ link: String?) {
        guard let u = URL(string: link ?? "https://www.viking.com/") else { return }
        let browser = VikingBrowser(url: u) { [weak self] page in
            var m = page; m["type"] = "viking"
            self?.send(m)
        }
        let nav = UINavigationController(rootViewController: browser)
        nav.modalPresentationStyle = .fullScreen
        present(nav, animated: true)
    }

    static var cruisesFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("my-cruises.json")
    }

    // MARK: Location (one fix at a time; nothing runs in the background)
    private func locate() {
        wantFix = true
        switch loc.authorizationStatus {
        case .notDetermined: loc.requestWhenInUseAuthorization()
        case .denied, .restricted: send(["type": "error", "message": "Location is off for Port Guide. Turn it on in Settings › Port Guide › Location."])
        default: loc.requestLocation()
        }
    }
    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        guard wantFix else { return }
        if m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways { m.requestLocation() }
        else if m.authorizationStatus == .denied { send(["type": "error", "message": "Location is off for Port Guide. Turn it on in Settings › Port Guide › Location."]) }
    }
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last, wantFix else { return }
        wantFix = false
        send(["type": "location", "lat": l.coordinate.latitude, "lon": l.coordinate.longitude, "acc": l.horizontalAccuracy])
    }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        if wantFix { wantFix = false; send(["type": "error", "message": "Couldn't get a GPS fix — try again in the open."]) }
    }

    // MARK: All-aboard reminders
    private func schedule(_ items: [[String: Any]]) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { ok, _ in
            guard ok else {
                self.send(["type": "error", "message": "Notifications are off for Port Guide. Turn them on in Settings › Notifications › Port Guide."]); return
            }
            for it in items {
                guard let id = it["id"] as? String, let at = it["at"] as? Double else { continue }
                let when = Date(timeIntervalSince1970: at / 1000)
                guard when > Date() else { continue }
                let c = UNMutableNotificationContent()
                c.title = it["title"] as? String ?? "All aboard"
                c.body = it["body"] as? String ?? ""
                c.sound = .default
                let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: when)
                center.add(UNNotificationRequest(identifier: id, content: c, trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)))
            }
        }
    }

    // MARK: Phrases out loud
    private func speak(_ text: String, lang: String) {
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.duckOthers])
        voice.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: lang) ?? AVSpeechSynthesisVoice(language: String(lang.prefix(2)))
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
        voice.speak(u)
    }

    // MARK: Links to Maps and websites open outside the app
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, let s = u.scheme?.lowercased(), s != "file", s != "about" {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { UIApplication.shared.open(u) }
        return nil
    }

    private func send(_ dict: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: dict), let s = String(data: d, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web?.evaluateJavaScript("window.__portNative && window.__portNative(\(s))") }
    }
}

/// Avoids a retain cycle between the web view and its message handler.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(uc, didReceive: m) }
}
