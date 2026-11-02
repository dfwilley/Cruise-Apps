import XCTest

/// Opens the app (the simulator has no GPS fix or compass, so it previews the voyage on the Inside Passage) and saves screenshots.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        addUIInterruptionMonitor(withDescription: "Location") { alert in
            for b in ["Allow While Using App", "Allow Once", "Allow"] where alert.buttons[b].exists { alert.buttons[b].tap(); return true }
            return false
        }
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        XCTAssertTrue(web.descendants(matching: .any)["Fjord Spotter"].firstMatch.waitForExistence(timeout: 15), "screens loaded inside the app")
        sleep(3); app.tap()
        snap(app, "1-look")
        for (tab, name) in [("Port & Stbd", "2-sides"), ("Lights", "3-lights"), ("Settings", "4-settings")] {
            let b = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", tab)).firstMatch
            if b.waitForExistence(timeout: 5) { b.tap(); sleep(2); snap(app, name) }
        }
    }
}
