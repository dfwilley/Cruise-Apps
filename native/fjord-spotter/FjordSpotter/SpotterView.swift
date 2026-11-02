import SwiftUI
import WebKit
import CoreLocation
import AVFoundation

/// The Fjord Spotter screens (bundled, so they work with no Wi-Fi) on top of an optional live camera view.
/// The screens ask for: "start" (GPS + compass) and "camera" (on/off). This side sends back GPS fixes and true-north heading.
struct SpotterView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SpotterController { SpotterController() }
    func updateUIViewController(_ vc: SpotterController, context: Context) {}
}

final class SpotterController: UIViewController, WKScriptMessageHandler, CLLocationManagerDelegate {
    private var web: WKWebView!
    private let loc = CLLocationManager()
    private var session: AVCaptureSession?
    private var preview: AVCaptureVideoPreviewLayer?
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 7/255, green: 26/255, blue: 38/255, alpha: 1)
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(WeakHandler(self), name: "fjord")
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.accessibilityIdentifier = "fjordWeb"
        view.addSubview(web)
        if let dir = Bundle.main.url(forResource: "fjord-spotter", withExtension: nil) {
            web.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        }
        loc.delegate = self
        loc.desiredAccuracy = kCLLocationAccuracyBest
        loc.distanceFilter = 20
        loc.headingFilter = 1
        loc.headingOrientation = .portrait
    }

    // MARK: Messages from the screens
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let cmd = m["cmd"] as? String else { return }
        switch cmd {
        case "start": startSensors()
        case "camera": setCamera(on: (m["on"] as? Bool) ?? false)
        default: break
        }
    }

    private func startSensors() {
        guard !started else { return }
        started = true
        if loc.authorizationStatus == .notDetermined { loc.requestWhenInUseAuthorization() }
        loc.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { loc.startUpdatingHeading() }
        else { send(["type": "error", "message": "This device has no compass — use the direction slider."]) }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if started, m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways {
            m.startUpdatingLocation(); if CLLocationManager.headingAvailable() { m.startUpdatingHeading() }
        }
    }
    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        guard let l = locs.last else { return }
        send(["type": "location", "lat": l.coordinate.latitude, "lon": l.coordinate.longitude,
              "course": l.course, "speed": l.speed, "acc": l.horizontalAccuracy])
    }
    func locationManager(_ m: CLLocationManager, didUpdateHeading h: CLHeading) {
        let v = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
        send(["type": "heading", "heading": v, "accuracy": h.headingAccuracy])
    }
    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}
    func locationManagerShouldDisplayHeadingCalibration(_ m: CLLocationManager) -> Bool { true }

    private func send(_ dict: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: dict), let s = String(data: d, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.web?.evaluateJavaScript("window.__fjordNative && window.__fjordNative(\(s))") }
    }

    // MARK: Camera behind the screens
    private func setCamera(on: Bool) {
        if on {
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async {
                    guard ok else { self.send(["type": "error", "message": "Camera access is off. Turn it on in Settings › Fjord Spotter."]); return }
                    self.startCamera()
                }
            }
        } else {
            session?.stopRunning(); preview?.removeFromSuperlayer(); session = nil; preview = nil
        }
    }
    private func startCamera() {
        guard session == nil, let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: dev) else {
            send(["type": "error", "message": "No camera available."]); return
        }
        let s = AVCaptureSession(); s.sessionPreset = .high
        if s.canAddInput(input) { s.addInput(input) }
        let p = AVCaptureVideoPreviewLayer(session: s)
        p.videoGravity = .resizeAspectFill; p.frame = view.bounds
        view.layer.insertSublayer(p, at: 0)
        session = s; preview = p
        DispatchQueue.global(qos: .userInitiated).async { s.startRunning() }
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
}

/// Avoids a retain cycle between the web view and its message handler.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(uc, didReceive: m) }
}
