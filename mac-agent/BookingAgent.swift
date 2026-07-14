import AppKit
import EventKit
import Foundation
import ServiceManagement

// BookingAgent: menu bar app that pushes calendar busy times to the booking
// server every 5 minutes. First launch asks for the server URL + API token.
// Only start/end times leave the Mac — no titles, attendees, or locations.

struct Config: Codable {
    var appUrl: String
    var token: String
    var days: Int?

    static let dir = ("~/Library/Application Support/BookingAgent" as NSString)
        .expandingTildeInPath
    static let path = dir + "/config.json"

    static func load() -> Config? {
        guard let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONDecoder().decode(Config.self, from: data)
    }

    func save() {
        try? FileManager.default.createDirectory(
            atPath: Config.dir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(self) {
            FileManager.default.createFile(
                atPath: Config.path, contents: data,
                attributes: [.posixPermissions: 0o600])
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private let statusLine = NSMenuItem(title: "Not synced yet", action: nil, keyEquivalent: "")
    private let store = EKEventStore()
    private var timer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(
            systemSymbolName: "calendar.badge.clock", accessibilityDescription: "BookingAgent")

        let menu = NSMenu()
        statusLine.isEnabled = false
        menu.addItem(statusLine)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Sync now", action: #selector(syncNow), keyEquivalent: "s")
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu

        if #available(macOS 13.0, *) {
            try? SMAppService.mainApp.register() // start at login
        }

        if Config.load() == nil {
            promptForSettings(message: "Welcome! Paste your booking API token to get started.")
        }

        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.sync()
        }
        sync()
    }

    @objc private func syncNow() { sync() }

    @objc private func openSettings() {
        promptForSettings(message: "Server URL and API token (dashboard → Local calendar agent).")
    }

    private func promptForSettings(message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let existing = Config.load()

        let alert = NSAlert()
        alert.messageText = "BookingAgent settings"
        alert.informativeText = message
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")

        let urlField = NSTextField(frame: NSRect(x: 0, y: 58, width: 320, height: 24))
        urlField.placeholderString = "Server URL"
        urlField.stringValue = existing?.appUrl ?? "https://booking.packetfence.net"
        let tokenField = NSTextField(frame: NSRect(x: 0, y: 26, width: 320, height: 24))
        tokenField.placeholderString = "API token"
        tokenField.stringValue = existing?.token ?? ""
        let hint = NSTextField(
            labelWithString: "Find the token on your dashboard under “Local calendar agent”.")
        hint.frame = NSRect(x: 0, y: 0, width: 320, height: 18)
        hint.font = .systemFont(ofSize: 11)
        hint.textColor = .secondaryLabelColor

        let box = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 86))
        box.addSubview(urlField)
        box.addSubview(tokenField)
        box.addSubview(hint)
        alert.accessoryView = box
        alert.window.initialFirstResponder = tokenField

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var url = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        while url.hasSuffix("/") { url.removeLast() }
        let token = tokenField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty, !token.isEmpty else { return }
        Config(appUrl: url, token: token, days: Config.load()?.days ?? 60).save()
        sync()
    }

    private func setStatus(_ text: String) {
        DispatchQueue.main.async { self.statusLine.title = text }
    }

    private func sync() {
        guard let config = Config.load() else {
            setStatus("No token configured")
            return
        }
        let handler: (Bool) -> Void = { [weak self] granted in
            guard let self else { return }
            guard granted else {
                self.setStatus("Calendar access denied")
                return
            }
            self.pushBusyBlocks(config: config)
        }
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in handler(ok) }
        } else {
            store.requestAccess(to: .event) { ok, _ in handler(ok) }
        }
    }

    private func pushBusyBlocks(config: Config) {
        let now = Date()
        guard
            let horizon = Calendar.current.date(
                byAdding: .day, value: config.days ?? 60, to: now),
            let url = URL(string: config.appUrl + "/api/busy")
        else {
            setStatus("Bad settings")
            return
        }
        let predicate = store.predicateForEvents(withStart: now, end: horizon, calendars: nil)
        let events = store.events(matching: predicate)

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]

        var intervals: [[String: String]] = []
        for event in events {
            if event.isAllDay { continue }
            if event.availability == .free { continue }
            if event.status == .canceled { continue }
            if let me = event.attendees?.first(where: { $0.isCurrentUser }),
               me.participantStatus == .declined { continue }
            guard let start = event.startDate, let end = event.endDate, end > start else { continue }
            intervals.append(["start": iso.string(from: start), "end": iso.string(from: end)])
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try? JSONSerialization.data(
            withJSONObject: ["source": "mac-eventkit", "intervals": intervals])
        request.timeoutInterval = 30

        let count = intervals.count
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            let time = DateFormatter.localizedString(
                from: Date(), dateStyle: .none, timeStyle: .short)
            if let error = error {
                self.setStatus("Sync failed: \(error.localizedDescription)")
            } else if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                self.setStatus(
                    http.statusCode == 401
                        ? "Invalid token — check Settings"
                        : "Sync failed: HTTP \(http.statusCode)")
            } else {
                self.setStatus("Synced \(count) busy blocks at \(time)")
            }
        }.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
