import XCTest

/// Opens the app previewing the first night in Tromsø and saves screenshots for review.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        app.launchArguments = ["-previewNow", "2027-01-30T21:30:00Z"]
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        XCTAssertTrue(web.descendants(matching: .any)["Arctic Night"].firstMatch.waitForExistence(timeout: 15), "the screens loaded from inside the app")
        sleep(8) // let live NOAA data arrive over the network
        snap(app, "1-tonight")
        web.swipeUp(); sleep(1); snap(app, "2-voyage")
        web.swipeUp(); web.swipeUp(); sleep(1); snap(app, "3-settings")
    }
}
