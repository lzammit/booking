import EventKit
import Foundation

// Booking busy-sync agent: reads busy intervals from macOS Calendar (EventKit)
// and pushes them to the booking server. Only start/end times leave the Mac —
// no titles, attendees, or locations.
//
// Config: ~/Library/Application Support/BookingAgent/config.json
//   { "appUrl": "http://...", "token": "<host api token>", "days": 60 }

struct Config: Codable {
    let appUrl: String
    let token: String
    let days: Int?
}

let configPath = ("~/Library/Application Support/BookingAgent/config.json" as NSString)
    .expandingTildeInPath

guard let data = FileManager.default.contents(atPath: configPath),
      let config = try? JSONDecoder().decode(Config.self, from: data)
else {
    fputs("booking-agent: missing or invalid config at \(configPath)\n", stderr)
    exit(1)
}

let store = EKEventStore()
let accessSem = DispatchSemaphore(value: 0)
var granted = false
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, _ in
        granted = ok
        accessSem.signal()
    }
} else {
    store.requestAccess(to: .event) { ok, _ in
        granted = ok
        accessSem.signal()
    }
}
accessSem.wait()
guard granted else {
    fputs("booking-agent: calendar access denied. Grant it in System Settings > Privacy & Security > Calendars.\n", stderr)
    exit(1)
}

let now = Date()
let horizon = Calendar.current.date(byAdding: .day, value: config.days ?? 60, to: now)!
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

let payload: [String: Any] = ["source": "mac-eventkit", "intervals": intervals]
guard let url = URL(string: config.appUrl + "/api/busy") else {
    fputs("booking-agent: bad appUrl\n", stderr)
    exit(1)
}
var request = URLRequest(url: url)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
request.httpBody = try! JSONSerialization.data(withJSONObject: payload)
request.timeoutInterval = 30

let netSem = DispatchSemaphore(value: 0)
var exitCode: Int32 = 1
URLSession.shared.dataTask(with: request) { body, response, error in
    if let error = error {
        fputs("booking-agent: request failed: \(error.localizedDescription)\n", stderr)
    } else if let http = response as? HTTPURLResponse {
        if http.statusCode == 200 {
            print("booking-agent: pushed \(intervals.count) busy blocks")
            exitCode = 0
        } else {
            let text = body.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            fputs("booking-agent: server returned \(http.statusCode): \(text)\n", stderr)
        }
    }
    netSem.signal()
}.resume()
netSem.wait()
exit(exitCode)
