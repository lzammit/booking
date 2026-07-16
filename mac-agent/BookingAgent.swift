import AppKit
import EventKit
import Foundation
import ServiceManagement

// BookingAgent: menu bar app that syncs with the booking server every
// 5 minutes, in both directions:
//  - pushes calendar busy times up (only start/end times leave the Mac —
//    no titles, attendees, or locations), and
//  - pulls bookings down, creating/updating/removing events in the local
//    calendar. This is how bookings reach the host's calendar when email
//    invites can't (corporate Exchange strips inline calendar parts).
// First launch asks for the server URL + API token.

struct Config: Codable {
    var appUrl: String
    var token: String
    var days: Int?
    /// Optional published Outlook calendar (ICS URL). For hosts whose events
    /// live only in the Outlook app (no macOS Internet Accounts): OWA →
    /// Settings → Calendar → Shared calendars → Publish a calendar.
    var icsUrl: String?

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

/// Local map of booking id → EKEvent identifier, so agent-created events can
/// be recognized later without any visible marker in the event notes.
enum EventMap {
    static let path = Config.dir + "/events.json"

    static func load() -> [String: String] {
        guard let data = FileManager.default.contents(atPath: path),
              let map = try? JSONDecoder().decode([String: String].self, from: data)
        else { return [:] }
        return map
    }

    static func save(_ map: [String: String]) {
        try? FileManager.default.createDirectory(
            atPath: Config.dir, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(map) {
            FileManager.default.createFile(atPath: path, contents: data)
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

        importSidecarConfigIfNeeded()
        if Config.load() == nil {
            promptForSettings(message: "Welcome! Paste your booking API token to get started.")
        }

        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.sync()
        }
        sync()
    }

    /// Personalized downloads ship a booking-config.json next to the app
    /// bundle. Import it on first launch so no manual token entry is needed,
    /// then delete it (it contains the API token).
    private func importSidecarConfigIfNeeded() {
        guard Config.load() == nil else { return }
        let sidecar = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .appendingPathComponent("booking-config.json")
        guard let data = try? Data(contentsOf: sidecar),
              let cfg = try? JSONDecoder().decode(Config.self, from: data),
              !cfg.appUrl.isEmpty, !cfg.token.isEmpty
        else { return }
        cfg.save()
        try? FileManager.default.removeItem(at: sidecar)
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

        let urlField = NSTextField(frame: NSRect(x: 0, y: 90, width: 340, height: 24))
        urlField.placeholderString = "Server URL"
        urlField.stringValue = existing?.appUrl ?? "https://booking.packetfence.net"
        let tokenField = NSTextField(frame: NSRect(x: 0, y: 58, width: 340, height: 24))
        tokenField.placeholderString = "API token"
        tokenField.stringValue = existing?.token ?? ""
        let icsField = NSTextField(frame: NSRect(x: 0, y: 26, width: 340, height: 24))
        icsField.placeholderString = "Calendar ICS feed URL (optional)"
        icsField.stringValue = existing?.icsUrl ?? ""
        let hint = NSTextField(
            labelWithString: "Token: dashboard → “Local calendar agent”. ICS: Google Calendar secret address, published Outlook, or iCloud link.")
        hint.frame = NSRect(x: 0, y: 0, width: 340, height: 18)
        hint.font = .systemFont(ofSize: 10)
        hint.textColor = .secondaryLabelColor

        let box = NSView(frame: NSRect(x: 0, y: 0, width: 340, height: 118))
        box.addSubview(urlField)
        box.addSubview(tokenField)
        box.addSubview(icsField)
        box.addSubview(hint)
        alert.accessoryView = box
        alert.window.initialFirstResponder = tokenField

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        var url = urlField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        while url.hasSuffix("/") { url.removeLast() }
        let token = tokenField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let ics = icsField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty, !token.isEmpty else { return }
        Config(
            appUrl: url, token: token, days: Config.load()?.days ?? 60,
            icsUrl: ics.isEmpty ? nil : ics
        ).save()
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
                self.syncIcsBusy(config: config, statusPrefix: "Synced \(count) busy", time: time)
            }
        }.resume()
    }

    // MARK: - Outlook ICS feed → busy blocks

    /// For hosts whose events live only in the Outlook app: fetch their
    /// published Outlook calendar (ICS) and push its busy intervals as a
    /// separate source.
    private func syncIcsBusy(config: Config, statusPrefix: String, time: String) {
        guard let icsString = config.icsUrl, !icsString.isEmpty,
              let icsURL = URL(string: icsString)
        else {
            pullBookings(config: config, statusPrefix: statusPrefix, time: time)
            return
        }

        URLSession.shared.dataTask(with: icsURL) { [weak self] data, _, error in
            guard let self else { return }
            guard error == nil, let data, let text = String(data: data, encoding: .utf8) else {
                self.pullBookings(config: config, statusPrefix: statusPrefix + " · ICS fetch failed", time: time)
                return
            }
            let now = Date()
            let horizon = now.addingTimeInterval(Double(config.days ?? 60) * 86400)
            let intervals = ICSParser.busyIntervals(ics: text, windowStart: now, windowEnd: horizon)

            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime]
            guard let url = URL(string: config.appUrl + "/api/busy") else {
                self.pullBookings(config: config, statusPrefix: statusPrefix, time: time)
                return
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try? JSONSerialization.data(withJSONObject: [
                "source": "outlook-ics",
                "intervals": intervals.map {
                    ["start": iso.string(from: $0.start), "end": iso.string(from: $0.end)]
                },
            ])
            request.timeoutInterval = 30

            URLSession.shared.dataTask(with: request) { _, response, error in
                let ok = error == nil && (response as? HTTPURLResponse)?.statusCode == 200
                let prefix = ok
                    ? statusPrefix + " · \(intervals.count) Outlook"
                    : statusPrefix + " · ICS push failed"
                self.pullBookings(config: config, statusPrefix: prefix, time: time)
            }.resume()
        }.resume()
    }

    // MARK: - Bookings → local calendar

    private struct AgentBooking: Decodable {
        let id: Int
        let summary: String
        let start: String
        let end: String
        let status: String
        let guestName: String
        let guestEmail: String
        let notes: String
    }

    private struct BookingsResponse: Decodable {
        let bookings: [AgentBooking]
    }

    private func pullBookings(config: Config, statusPrefix: String, time: String) {
        guard let url = URL(string: config.appUrl + "/api/agent/bookings") else {
            setStatus("\(statusPrefix) at \(time)")
            return
        }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            guard error == nil,
                  let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data,
                  let decoded = try? JSONDecoder().decode(BookingsResponse.self, from: data)
            else {
                // Older server without the endpoint — busy sync still counts.
                self.setStatus("\(statusPrefix) at \(time)")
                return
            }
            let applied = self.reconcile(bookings: decoded.bookings, config: config)
            self.setStatus("\(statusPrefix) · \(applied) bookings at \(time)")
        }.resume()
    }

    private func parseISO(_ s: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    /// Create/update/remove local calendar events to match the server's
    /// bookings. Agent-created events are tracked in a local booking-id →
    /// event-identifier map (EventMap), so their notes stay clean — no
    /// visible markers. Returns the number of bookings on the calendar.
    private func reconcile(bookings: [AgentBooking], config: Config) -> Int {
        guard let calendar = store.defaultCalendarForNewEvents
            ?? store.calendars(for: .event).first(where: { $0.allowsContentModifications })
        else { return 0 }

        var map = EventMap.load()

        // Migration: adopt events still carrying the legacy "[booking#N]"
        // notes marker into the map and scrub the marker from their notes.
        let windowStart = Date().addingTimeInterval(-3 * 24 * 3600)
        let windowEnd = Date().addingTimeInterval(180 * 24 * 3600)
        let predicate = store.predicateForEvents(
            withStart: windowStart, end: windowEnd, calendars: nil)
        for event in store.events(matching: predicate) {
            guard let notes = event.notes,
                  let markerRange = notes.range(of: #"\[booking#(\d+)\]"#, options: .regularExpression)
            else { continue }
            let id = notes[markerRange].dropFirst("[booking#".count).dropLast()
            let cleaned = notes
                .replacingOccurrences(
                    of: #"\n?\[booking#\d+\]"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            event.notes = cleaned.isEmpty ? nil : cleaned
            try? store.save(event, span: .thisEvent, commit: true)
            if map[String(id)] == nil, let identifier = event.eventIdentifier {
                map[String(id)] = identifier
            }
        }

        var applied = 0
        for booking in bookings {
            guard let start = parseISO(booking.start), let end = parseISO(booking.end) else { continue }
            let key = String(booking.id)
            let existing = map[key].flatMap { store.event(withIdentifier: $0) }

            if booking.status != "confirmed" {
                if let event = existing {
                    try? store.remove(event, span: .thisEvent, commit: true)
                }
                map.removeValue(forKey: key)
                continue
            }

            let notes = [
                "\(booking.guestName) <\(booking.guestEmail)>",
                booking.notes.isEmpty ? nil : "Notes: \(booking.notes)",
            ].compactMap { $0 }.joined(separator: "\n")

            if let event = existing {
                if event.title != booking.summary || event.startDate != start
                    || event.endDate != end || event.notes != notes {
                    event.title = booking.summary
                    event.startDate = start
                    event.endDate = end
                    event.notes = notes
                    try? store.save(event, span: .thisEvent, commit: true)
                }
                applied += 1
            } else if end > Date() {
                let event = EKEvent(eventStore: store)
                event.calendar = calendar
                event.title = booking.summary
                event.startDate = start
                event.endDate = end
                event.notes = notes
                do {
                    try store.save(event, span: .thisEvent, commit: true)
                    if let identifier = event.eventIdentifier {
                        map[key] = identifier
                    }
                    applied += 1
                } catch {
                    NSLog("BookingAgent: failed to save event for booking \(booking.id): \(error)")
                }
            }
        }
        EventMap.save(map)
        return applied
    }
}

// MARK: - Minimal ICS parser (published Outlook calendars)

enum ICSParser {
    struct Prop {
        let params: [String: String]
        let value: String
    }

    /// Microsoft publishes ICS with Windows time zone names.
    private static let windowsTimeZones: [String: String] = [
        "Eastern Standard Time": "America/New_York",
        "Central Standard Time": "America/Chicago",
        "Mountain Standard Time": "America/Denver",
        "Pacific Standard Time": "America/Los_Angeles",
        "Atlantic Standard Time": "America/Halifax",
        "Alaskan Standard Time": "America/Anchorage",
        "Hawaiian Standard Time": "Pacific/Honolulu",
        "UTC": "UTC",
        "Coordinated Universal Time": "UTC",
        "GMT Standard Time": "Europe/London",
        "W. Europe Standard Time": "Europe/Berlin",
        "Romance Standard Time": "Europe/Paris",
        "Central Europe Standard Time": "Europe/Budapest",
        "Central European Standard Time": "Europe/Warsaw",
        "E. Europe Standard Time": "Europe/Bucharest",
        "FLE Standard Time": "Europe/Helsinki",
        "Israel Standard Time": "Asia/Jerusalem",
        "Arabian Standard Time": "Asia/Dubai",
        "India Standard Time": "Asia/Kolkata",
        "China Standard Time": "Asia/Shanghai",
        "Tokyo Standard Time": "Asia/Tokyo",
        "Korea Standard Time": "Asia/Seoul",
        "AUS Eastern Standard Time": "Australia/Sydney",
        "New Zealand Standard Time": "Pacific/Auckland",
        "SA Pacific Standard Time": "America/Bogota",
        "E. South America Standard Time": "America/Sao_Paulo",
    ]

    static func busyIntervals(
        ics: String, windowStart: Date, windowEnd: Date
    ) -> [(start: Date, end: Date)] {
        // Unfold continuation lines.
        let unfolded = ics
            .replacingOccurrences(of: "\r\n ", with: "")
            .replacingOccurrences(of: "\r\n\t", with: "")
            .replacingOccurrences(of: "\n ", with: "")
            .replacingOccurrences(of: "\n\t", with: "")

        var out: [(start: Date, end: Date)] = []
        var current: [String: Prop] = [:]
        var exdates: [Date] = []
        var inEvent = false

        for rawLine in unfolded.components(separatedBy: .newlines) {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
            if line == "BEGIN:VEVENT" {
                inEvent = true
                current = [:]
                exdates = []
                continue
            }
            if line == "END:VEVENT" {
                inEvent = false
                out += expand(current, exdates: exdates, windowStart: windowStart, windowEnd: windowEnd)
                continue
            }
            guard inEvent, let (name, prop) = parseLine(line) else { continue }
            if name == "EXDATE" {
                for value in prop.value.components(separatedBy: ",") {
                    if let date = parseDate(Prop(params: prop.params, value: value)).date {
                        exdates.append(date)
                    }
                }
            } else if ["DTSTART", "DTEND", "DURATION", "RRULE", "TRANSP", "STATUS"].contains(name) {
                current[name] = prop
            }
        }
        return out
    }

    /// "NAME;P1=V1;P2="quoted:value":value" → (NAME, params, value).
    private static func parseLine(_ line: String) -> (String, Prop)? {
        var inQuotes = false
        var colonIndex: String.Index?
        for index in line.indices {
            let ch = line[index]
            if ch == "\"" { inQuotes.toggle() }
            if ch == ":" && !inQuotes {
                colonIndex = index
                break
            }
        }
        guard let colonIndex else { return nil }
        let head = String(line[..<colonIndex])
        let value = String(line[line.index(after: colonIndex)...])
        var parts = head.components(separatedBy: ";")
        let name = parts.removeFirst().uppercased()
        var params: [String: String] = [:]
        for part in parts {
            let kv = part.components(separatedBy: "=")
            guard kv.count >= 2 else { continue }
            params[kv[0].uppercased()] = kv[1...].joined(separator: "=")
                .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        }
        return (name, Prop(params: params, value: value))
    }

    private static func parseDate(_ prop: Prop) -> (date: Date?, isDateOnly: Bool, zone: TimeZone) {
        let value = prop.value
        var zone = TimeZone(identifier: "UTC")!
        if prop.params["VALUE"] == "DATE" || (!value.contains("T") && value.count == 8) {
            return (nil, true, zone)
        }
        var text = value
        if text.hasSuffix("Z") {
            text = String(text.dropLast())
        } else if let tzid = prop.params["TZID"] {
            zone = TimeZone(identifier: tzid)
                ?? windowsTimeZones[tzid].flatMap(TimeZone.init(identifier:))
                ?? zone
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = zone
        formatter.dateFormat = "yyyyMMdd'T'HHmmss"
        return (formatter.date(from: text), false, zone)
    }

    private static func parseDuration(_ value: String) -> TimeInterval? {
        var seconds: TimeInterval = 0
        var number = ""
        var inTime = false
        for ch in value {
            switch ch {
            case "P", "+": continue
            case "T": inTime = true
            case "0"..."9": number.append(ch)
            case "W": seconds += (Double(number) ?? 0) * 604800; number = ""
            case "D": seconds += (Double(number) ?? 0) * 86400; number = ""
            case "H": seconds += (Double(number) ?? 0) * 3600; number = ""
            case "M": seconds += (Double(number) ?? 0) * (inTime ? 60 : 2_592_000); number = ""
            case "S": seconds += (Double(number) ?? 0); number = ""
            default: return nil
            }
        }
        return seconds > 0 ? seconds : nil
    }

    private static func expand(
        _ props: [String: Prop], exdates: [Date], windowStart: Date, windowEnd: Date
    ) -> [(start: Date, end: Date)] {
        if props["TRANSP"]?.value.uppercased() == "TRANSPARENT" { return [] }
        if props["STATUS"]?.value.uppercased() == "CANCELLED" { return [] }
        guard let dtstart = props["DTSTART"] else { return [] }
        let (startOpt, isDateOnly, zone) = parseDate(dtstart)
        guard let seriesStart = startOpt, !isDateOnly else { return [] }  // all-day skipped

        var duration: TimeInterval = 1800
        if let dtend = props["DTEND"], let end = parseDate(dtend).date {
            duration = max(60, end.timeIntervalSince(seriesStart))
        } else if let dur = props["DURATION"].flatMap({ parseDuration($0.value) }) {
            duration = max(60, dur)
        }

        var out: [(start: Date, end: Date)] = []
        func emit(_ start: Date) {
            let end = start.addingTimeInterval(duration)
            guard end > windowStart, start < windowEnd else { return }
            guard !exdates.contains(where: { abs($0.timeIntervalSince(start)) < 1 }) else { return }
            out.append((start, end))
        }

        guard let rrule = props["RRULE"]?.value else {
            emit(seriesStart)
            return out
        }

        var rules: [String: String] = [:]
        for part in rrule.components(separatedBy: ";") {
            let kv = part.components(separatedBy: "=")
            if kv.count == 2 { rules[kv[0].uppercased()] = kv[1] }
        }
        let interval = max(1, Int(rules["INTERVAL"] ?? "1") ?? 1)
        let count = rules["COUNT"].flatMap(Int.init)
        var until: Date?
        if let u = rules["UNTIL"] {
            if u.contains("T") {
                until = parseDate(Prop(params: [:], value: u)).date
            } else {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(identifier: "UTC")
                formatter.dateFormat = "yyyyMMdd"
                until = formatter.date(from: u)?.addingTimeInterval(86399)
            }
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        var occurrences = 0
        let maxIterations = 800

        func stillGoing(_ date: Date) -> Bool {
            if let count, occurrences >= count { return false }
            if let until, date > until { return false }
            return date < windowEnd
        }

        switch rules["FREQ"] {
        case "DAILY":
            var cursor = seriesStart
            var iterations = 0
            while stillGoing(cursor), iterations < maxIterations {
                emit(cursor)
                occurrences += 1
                guard let next = calendar.date(byAdding: .day, value: interval, to: cursor) else { break }
                cursor = next
                iterations += 1
            }
        case "WEEKLY":
            let weekdayMap = ["SU": 1, "MO": 2, "TU": 3, "WE": 4, "TH": 5, "FR": 6, "SA": 7]
            let weekdays: [Int] = rules["BYDAY"]?
                .components(separatedBy: ",")
                .compactMap { weekdayMap[String($0.suffix(2))] }
                .sorted()
                ?? [calendar.component(.weekday, from: seriesStart)]
            let timeOfDay = calendar.dateComponents([.hour, .minute, .second], from: seriesStart)
            var weekCursor = seriesStart
            var iterations = 0
            outer: while iterations < maxIterations {
                for weekday in weekdays {
                    var comps = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: weekCursor)
                    comps.weekday = weekday
                    guard let day = calendar.date(from: comps),
                          let occurrence = calendar.date(
                            bySettingHour: timeOfDay.hour ?? 0,
                            minute: timeOfDay.minute ?? 0,
                            second: timeOfDay.second ?? 0,
                            of: day
                          )
                    else { continue }
                    if occurrence < seriesStart { continue }
                    if !stillGoing(occurrence) { break outer }
                    emit(occurrence)
                    occurrences += 1
                }
                guard let next = calendar.date(byAdding: .weekOfYear, value: interval, to: weekCursor) else { break }
                weekCursor = next
                iterations += 1
            }
        case "MONTHLY" where rules["BYDAY"] == nil:
            var cursor = seriesStart
            var iterations = 0
            while stillGoing(cursor), iterations < maxIterations {
                emit(cursor)
                occurrences += 1
                guard let next = calendar.date(byAdding: .month, value: interval, to: cursor) else { break }
                cursor = next
                iterations += 1
            }
        default:
            // Unsupported recurrence (e.g. MONTHLY BYDAY, YEARLY): first
            // occurrence only, so at least the master blocks its slot.
            emit(seriesStart)
        }
        return out
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
