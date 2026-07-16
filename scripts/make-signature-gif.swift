#!/usr/bin/swift
// Generates public/signature-badge.gif — an animated "Book time with me"
// email-signature badge in the circadian brand (ink button, paper text,
// dawn→noon→dusk accent strip sweeping in a loop). Every frame shows the
// complete button, so clients that don't animate GIFs (classic Windows
// Outlook) still show a perfect static badge.
// Usage: swift scripts/make-signature-gif.swift [output.gif]
import AppKit
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1] : "public/signature-badge.gif"

// Rendered at 2x (440x96) for crisp display at 220x48.
let width = 440
let height = 96
let frames = 24
let frameDelay = 0.08

let ink = NSColor(calibratedRed: 0x1C / 255, green: 0x23 / 255, blue: 0x33 / 255, alpha: 1)
let paper = NSColor(calibratedRed: 0xFB / 255, green: 0xFA / 255, blue: 0xF7 / 255, alpha: 1)
let dawn = NSColor(calibratedRed: 0xF0 / 255, green: 0x98 / 255, blue: 0x7E / 255, alpha: 1)
let noon = NSColor(calibratedRed: 0xED / 255, green: 0xBE / 255, blue: 0x4B / 255, alpha: 1)
let dusk = NSColor(calibratedRed: 0x7C / 255, green: 0x6F / 255, blue: 0xD9 / 255, alpha: 1)

func renderFrame(phase: CGFloat) -> CGImage? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { return nil }
    rep.size = NSSize(width: width, height: height)

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // White backdrop so the rounded corners look right on any background.
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()

    // Ink button.
    let button = NSRect(x: 0, y: 0, width: width, height: height)
    let path = NSBezierPath(roundedRect: button, xRadius: 16, yRadius: 16)
    ink.setFill()
    path.fill()

    // Animated circadian strip along the bottom, clipped to the button.
    NSGraphicsContext.saveGraphicsState()
    path.setClip()
    let stripHeight: CGFloat = 10
    // Gradient wider than the button, sliding by phase and wrapping.
    let colors = [dawn, noon, dusk, dawn, noon, dusk, dawn]
    let gradient = NSGradient(colors: colors)!
    let gradientWidth = CGFloat(width) * 2
    let offset = -gradientWidth / 2 + phase * gradientWidth / 2
    gradient.draw(
        in: NSRect(x: offset, y: 0, width: gradientWidth, height: stripHeight),
        angle: 0
    )
    NSGraphicsContext.restoreGraphicsState()

    // Label.
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let text = NSAttributedString(
        string: "📅  Book time with me  →",
        attributes: [
            .font: NSFont.systemFont(ofSize: 30, weight: .semibold),
            .foregroundColor: paper,
            .paragraphStyle: paragraph,
        ]
    )
    let textHeight = text.size().height
    text.draw(
        in: NSRect(
            x: 0, y: (CGFloat(height) - textHeight) / 2 + stripHeight / 2 - 2,
            width: CGFloat(width), height: textHeight
        )
    )

    NSGraphicsContext.restoreGraphicsState()
    return rep.cgImage
}

let url = URL(fileURLWithPath: output)
try? FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
guard let destination = CGImageDestinationCreateWithURL(
    url as CFURL, UTType.gif.identifier as CFString, frames, nil
) else {
    print("Could not create GIF destination")
    exit(1)
}
CGImageDestinationSetProperties(destination, [
    kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
] as CFDictionary)

for i in 0..<frames {
    let phase = CGFloat(i) / CGFloat(frames)
    guard let frame = renderFrame(phase: phase) else { continue }
    CGImageDestinationAddImage(destination, frame, [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: frameDelay]
    ] as CFDictionary)
}
guard CGImageDestinationFinalize(destination) else {
    print("Failed to write GIF")
    exit(1)
}
let size = (try? FileManager.default.attributesOfItem(atPath: output)[.size] as? Int) ?? 0
print("Wrote \(output) (\(size ?? 0) bytes)")
