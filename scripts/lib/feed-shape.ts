/**
 * The home timeline's stored SHAPE, read from the TypeScript types (src/lib/feed/format.ts
 * FeedShapeRoots: feed items, PostSummary, video snapshot, head/week/year docs), as one canonical
 * string and its fingerprint. test/node/feed-format.test.ts compares the fingerprint with
 * FEED_FORMAT_HISTORY[FEED_FORMAT], so a shape change without a FEED_FORMAT bump fails CI.
 *
 *   npm run feed:shape        prints the current fingerprint and shape (for a new history entry)
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PRIMITIVE =
   ts.TypeFlags.String |
   ts.TypeFlags.Number |
   ts.TypeFlags.Boolean |
   ts.TypeFlags.Null |
   ts.TypeFlags.Undefined |
   ts.TypeFlags.Unknown |
   ts.TypeFlags.Any |
   ts.TypeFlags.Never |
   ts.TypeFlags.BigInt |
   ts.TypeFlags.Void;

export function feedShape(root = ROOT): { shape: string; fingerprint: string } {
   const parsed = ts.getParsedCommandLineOfConfigFile(
      resolve(root, "tsconfig.json"),
      {},
      {
         ...ts.sys,
         onUnRecoverableConfigFileDiagnostic: (d) => {
            throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
         },
      },
   );
   if (!parsed) throw new Error("tsconfig.json could not be read");
   const file = resolve(root, "src/lib/feed/format.ts");
   const program = ts.createProgram([file], parsed.options);
   const checker = program.getTypeChecker();
   const sf = program.getSourceFile(file);
   if (!sf) throw new Error(`${file} not found`);
   let rootType: ts.Type | null = null;
   sf.forEachChild((n) => {
      if (ts.isInterfaceDeclaration(n) && n.name.text === "FeedShapeRoots") rootType = checker.getTypeAtLocation(n.name);
   });
   if (!rootType) throw new Error("FeedShapeRoots not found in src/lib/feed/format.ts");

   const walk = (t: ts.Type, stack: ts.Type[]): string => {
      if (t.flags & ts.TypeFlags.StringLiteral) return JSON.stringify((t as ts.StringLiteralType).value);
      if (t.flags & ts.TypeFlags.NumberLiteral) return String((t as ts.NumberLiteralType).value);
      if (t.flags & (PRIMITIVE | ts.TypeFlags.BooleanLiteral)) return checker.typeToString(t);
      if (t.isUnion()) return [...new Set(t.types.map((m) => walk(m, stack)))].sort().join(" | ");
      if (stack.includes(t)) return "<cycle>";
      const next = [...stack, t];
      const ref = t as ts.TypeReference;
      const symbol = t.getSymbol()?.getName();
      if ((symbol === "Array" || symbol === "ReadonlyArray") && checker.getTypeArguments(ref).length === 1) return `${walk(checker.getTypeArguments(ref)[0], next)}[]`;
      if (checker.isTupleType(t))
         return `[${checker
            .getTypeArguments(ref)
            .map((a) => walk(a, next))
            .join(", ")}]`;
      if (t.getCallSignatures().length) return "function";
      const parts = checker.getPropertiesOfType(t).map((p) => {
         const optional = p.flags & ts.SymbolFlags.Optional ? "?" : "";
         return `${p.getName()}${optional}: ${walk(checker.getTypeOfSymbol(p), next)}`;
      });
      for (const info of checker.getIndexInfosOfType(t)) parts.push(`[k: ${checker.typeToString(info.keyType)}]: ${walk(info.type, next)}`);
      return `{ ${parts.sort().join("; ")} }`;
   };
   const shape = walk(rootType, []);
   return {
      shape,
      fingerprint: createHash("sha256").update(shape).digest("hex").slice(0, 16),
   };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const { shape, fingerprint } = feedShape();
   process.stdout.write(`fingerprint: ${fingerprint}\n\n${shape.replace(/; /g, ";\n  ")}\n`);
}
