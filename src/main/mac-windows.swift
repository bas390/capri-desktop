import CoreGraphics
import Darwin
import Foundation

// The windows Capri can sit on, as one JSON line whenever the list changes.
// Bounds are points, origin at the top-left of the main display, the same space as her window.
// Titles are only matched against AI names; the title itself is never printed.
//   swift mac-windows.swift <capri pid>

let parent = Int32(CommandLine.arguments.dropFirst().first ?? "") ?? 0
let skipOwners: Set<String> = ["electron", "capri", "window server", "dock", "control center", "notification center", "systemuiserver"]

let ais: [(String, [String])] = [
    ("chatgpt", ["chatgpt"]),
    ("claude", ["claude"]),
    ("codex", ["codex"]),
    ("gemini", ["gemini"]),
    ("copilot", ["copilot"]),
    ("perplexity", ["perplexity"]),
    ("deepseek", ["deepseek"]),
    ("grok", ["grok"]),
    ("lechat", ["le chat", "mistral"]),
    ("characterai", ["character.ai", "character ai"]),
    ("metaai", ["meta ai"]),
]

func num(_ value: Any?) -> Double {
    if let n = value as? Double { return n }
    if let n = value as? Int { return Double(n) }
    if let n = value as? NSNumber { return n.doubleValue }
    return 0
}

func json(_ s: String) -> String {
    "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\""
}

func procPath(_ pid: Int32) -> String {
    let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
    defer { buf.deallocate() }
    let n = proc_pidpath(pid, buf, 4096)
    guard n > 0 else { return "" }
    return String(cString: buf)
}

func alive(_ pid: Int32) -> Bool {
    if pid <= 0 { return true }
    return kill(pid, 0) == 0 || errno == EPERM
}

func gameName(_ path: String) -> String? {
    let marks = ["/steamapps/common/", "/Epic Games/", "/Riot Games/", "/GOG Galaxy/Games/"]
    for mark in marks {
        guard let range = path.range(of: mark, options: .caseInsensitive) else { continue }
        let name = path[range.upperBound...].split(separator: "/").first.map(String.init) ?? ""
        if name.isEmpty || name.range(of: "launcher|client|redistributable|steamworks", options: [.regularExpression, .caseInsensitive]) != nil {
            continue
        }
        return name
    }
    return nil
}

func aiKeys(owner: String, title: String) -> [String] {
    let hay = (owner + " " + title).lowercased()
    return ais.compactMap { key, words in words.contains { hay.contains($0) } ? key : nil }
}

func snapshot() -> String {
    let opts = CGWindowListOption(rawValue: CGWindowListOption.optionOnScreenOnly.rawValue | CGWindowListOption.excludeDesktopElements.rawValue)
    let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []
    let selfPid = ProcessInfo.processInfo.processIdentifier
    var wins: [String] = []
    var fg = 0
    var ai: [String] = []
    var game: String?
    for w in info {
        if Int(num(w[kCGWindowLayer as String])) != 0 { continue }
        let pid = Int32(num(w[kCGWindowOwnerPID as String]))
        let title = w[kCGWindowName as String] as? String ?? ""
        // the demo terminal belongs to Capri's own process; everything else of hers stays out
        let demo = title.contains("night-city-api")
        if (pid == parent || pid == selfPid) && !demo { continue }
        if num(w[kCGWindowAlpha as String]) < 0.05 { continue }
        let box = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let x = num(box["X"])
        let y = num(box["Y"])
        let width = num(box["Width"])
        let height = num(box["Height"])
        if width < 200 || height < 120 { continue }
        let id = Int(num(w[kCGWindowNumber as String]))
        let owner = w[kCGWindowOwnerName as String] as? String ?? ""
        if skipOwners.contains(owner.lowercased()) && !demo { continue }
        if fg == 0 {
            fg = id
            ai = aiKeys(owner: owner, title: title)
            game = gameName(procPath(pid))
        }
        wins.append("{\"id\":\(id),\"x\":\(Int(x.rounded())),\"y\":\(Int(y.rounded())),\"w\":\(Int(width.rounded())),\"h\":\(Int(height.rounded())),\"max\":false}")
        if wins.count >= 40 { break }
    }
    let aiJson = "[" + ai.map { "\"\($0)\"" }.joined(separator: ",") + "]"
    let gameJson = game.map(json) ?? "null"
    return "{\"fg\":\(fg),\"taskbar\":false,\"ai\":\(aiJson),\"game\":\(gameJson),\"usb\":[],\"plug\":null,\"dip\":true,\"wins\":[" + wins.joined(separator: ",") + "]}"
}

var last = ""
var tick = 0
while true {
    let snap = snapshot()
    if snap != last {
        print(snap)
        fflush(stdout)
        last = snap
    }
    tick += 1
    if parent > 0 && tick % 20 == 0 && !alive(parent) { break }
    usleep(150_000)
}
