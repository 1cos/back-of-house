// XCF-GG-OCR — OCR gratuito e locale (Apple Vision) di un PDF scansionato.
// Uso: ocr-pdf <file.pdf>  → JSON su stdout:
//   { "engine": "apple-vision", "pages": [ { "width", "height", "tokens": [ { "text", "box": [4 vertici normalizzati] } ] } ] }
// Stesso formato delle fixture reali dei test (tests/fixtures/global-gourmet/*.ocr.json):
// parole con 4 vertici in coordinate 0..1, origine in alto a sinistra, ordine
// alto-sx, alto-dx, basso-dx, basso-sx. Le righe le ricostruisce ocr-layout.js.
import Foundation
import PDFKit
import Vision
import AppKit

struct Tok: Encodable { let text: String; let box: [[String: Double]] }
struct Page: Encodable { let width: Int; let height: Int; let tokens: [Tok] }
struct Out: Encodable { let engine: String; let pages: [Page] }

func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

guard CommandLine.arguments.count == 2, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { fail("uso: ocr-pdf <file.pdf>") }
if doc.pageCount > 30 { fail("troppe pagine: \(doc.pageCount)") }

var pages: [Page] = []
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let mb = page.bounds(for: .mediaBox)
    let scale: CGFloat = 2.0
    let size = NSSize(width: mb.width * scale, height: mb.height * scale)
    let img = page.thumbnail(of: size, for: .mediaBox)
    guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("pagina \(i + 1) non renderizzabile") }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false        // numeri, SKU e prezzi: niente "correzioni"
    req.recognitionLanguages = ["en-US"]
    do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { fail("Vision: \(error)") }
    var toks: [Tok] = []
    for obs in (req.results ?? []) {
        guard let cand = obs.topCandidates(1).first else { continue }
        let s = cand.string
        var idx = s.startIndex
        // una parola = un token, con il suo riquadro (come le fixture reali)
        for word in s.split(separator: " ", omittingEmptySubsequences: true) {
            guard let r = s.range(of: word, range: idx..<s.endIndex) else { continue }
            idx = r.upperBound
            guard let b = try? cand.boundingBox(for: r)?.boundingBox else { continue }
            // Vision: origine in basso a sinistra → in alto a sinistra
            let x0 = Double(b.minX), x1 = Double(b.maxX), y0 = 1 - Double(b.maxY), y1 = 1 - Double(b.minY)
            let r4 = { (v: Double) in (v * 10000).rounded() / 10000 }
            toks.append(Tok(text: String(word), box: [["x": r4(x0), "y": r4(y0)], ["x": r4(x1), "y": r4(y0)], ["x": r4(x1), "y": r4(y1)], ["x": r4(x0), "y": r4(y1)]]))
        }
    }
    pages.append(Page(width: cg.width, height: cg.height, tokens: toks))
}
let enc = JSONEncoder()
FileHandle.standardOutput.write(try! enc.encode(Out(engine: "apple-vision", pages: pages)))
