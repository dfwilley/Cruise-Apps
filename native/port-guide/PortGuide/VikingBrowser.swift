import UIKit
import WebKit

/// Viking's website (or My Viking Journey) inside the app. You browse to your cruise's itinerary as in Safari,
/// then tap "Use this itinerary": the page's text goes back to the guide, which reads the days, ports and times.
/// Uses the app's normal web storage, so a sign-in to My Viking Journey is remembered.
final class VikingBrowser: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let startURL: URL
    private let onGrab: ([String: Any]) -> Void
    private var web: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var observers: [NSKeyValueObservation] = []

    init(url: URL, onGrab: @escaping ([String: Any]) -> Void) {
        startURL = url; self.onGrab = onGrab
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    /// Everything readable on the page: what's on screen (innerText) and every piece of text,
    /// including folded day-by-day sections (nodes), one per line.
    private static let grabJS = """
    (function () {
      var skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, HEAD: 1 };
      var out = [];
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
        for (var p = n.parentElement; p; p = p.parentElement) if (skip[p.tagName.toUpperCase()]) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; } });
      while (w.nextNode()) out.push(w.currentNode.nodeValue.replace(/\\s+/g, ' ').trim());
      return { title: document.title || '', url: location.href, text: document.body.innerText || '', nodes: out.join('\\n') };
    })()
    """

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "Viking"
        navigationItem.prompt = "Open your cruise's itinerary, then tap Use this itinerary"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(close))
        let use = UIBarButtonItem(title: "Use this itinerary", style: .done, target: self, action: #selector(grab))
        use.accessibilityIdentifier = "useItinerary"
        navigationItem.rightBarButtonItem = use

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.accessibilityIdentifier = "vikingWeb"
        web.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web); view.addSubview(progress)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        let back = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: web, action: #selector(WKWebView.goBack))
        let fwd = UIBarButtonItem(image: UIImage(systemName: "chevron.forward"), style: .plain, target: web, action: #selector(WKWebView.goForward))
        let reload = UIBarButtonItem(barButtonSystemItem: .refresh, target: web, action: #selector(WKWebView.reload))
        toolbarItems = [back, .flexibleSpace(), fwd, .flexibleSpace(), reload]
        observers = [
            web.observe(\.estimatedProgress) { [weak self] w, _ in
                self?.progress.progress = Float(w.estimatedProgress); self?.progress.isHidden = w.estimatedProgress >= 1 },
            web.observe(\.canGoBack) { w, _ in back.isEnabled = w.canGoBack },
            web.observe(\.canGoForward) { w, _ in fwd.isEnabled = w.canGoForward },
        ]
        web.load(URLRequest(url: startURL))
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setToolbarHidden(false, animated: false) }

    @objc private func close() { dismiss(animated: true) }

    @objc private func grab() {
        web.evaluateJavaScript(Self.grabJS) { [weak self] result, _ in
            guard let self else { return }
            guard let d = result as? [String: Any], let text = d["text"] as? String, !text.isEmpty else {
                let a = UIAlertController(title: "Nothing to read yet", message: "Wait for the page to finish loading, then try again.", preferredStyle: .alert)
                a.addAction(UIAlertAction(title: "OK", style: .default)); self.present(a, animated: true); return
            }
            self.onGrab(d)
            self.dismiss(animated: true)
        }
    }

    // Links that open a new window stay in this browser.
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if a.targetFrame == nil { w.load(a.request) }
        return nil
    }
    // Phone numbers, email and app links go to the phone; web pages stay here.
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, let s = u.scheme?.lowercased(), !["http", "https", "about", "blob", "data"].contains(s) {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    // Sites sometimes ask "Are you sure?" — show their alerts and confirms properly.
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(a, animated: true)
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) }); present(a, animated: true)
    }
}
