import { describe, it, expect } from "vitest";
import {
  canonicalizeIdentifier,
  stripJidSuffix,
  extractNumericPart,
  isGroupJid,
  isDmJid,
  getExtensionFromMimeType,
} from "../src/gateway/platforms/whatsapp-lid.js";

describe("whatsapp-lid utilities", () => {
  describe("stripJidSuffix", () => {
    it("strips @s.whatsapp.net", () => {
      expect(stripJidSuffix("15551234567@s.whatsapp.net")).toBe("15551234567");
    });
    it("strips @g.us", () => {
      expect(stripJidSuffix("120363@g.us")).toBe("120363");
    });
    it("returns input if no suffix", () => {
      expect(stripJidSuffix("15551234567")).toBe("15551234567");
    });
  });

  describe("extractNumericPart", () => {
    it("extracts digits before @", () => {
      expect(extractNumericPart("15551234567@s.whatsapp.net")).toBe("15551234567");
    });
  });

  describe("isGroupJid / isDmJid", () => {
    it("detects group JIDs", () => {
      expect(isGroupJid("120363@g.us")).toBe(true);
      expect(isGroupJid("1555@s.whatsapp.net")).toBe(false);
    });
    it("detects DM JIDs", () => {
      expect(isDmJid("1555@s.whatsapp.net")).toBe(true);
      expect(isDmJid("120363@g.us")).toBe(false);
    });
  });

  describe("canonicalizeIdentifier", () => {
    it("returns the phone form when no mapping exists", () => {
      const mappings = new Map<string, string>();
      expect(canonicalizeIdentifier("15551234567@s.whatsapp.net", mappings)).toBe("15551234567@s.whatsapp.net");
    });

    it("resolves LID to phone number via mapping", () => {
      const mappings = new Map<string, string>([
        ["123456789", "15551234567"],
        ["15551234567", "123456789"],
      ]);
      const result = canonicalizeIdentifier("123456789@lid", mappings);
      expect(result).toBe("15551234567@s.whatsapp.net");
    });

    it("handles bidirectional mapping (phone -> LID -> phone)", () => {
      const mappings = new Map<string, string>([
        ["123456789", "15551234567"],
        ["15551234567", "123456789"],
      ]);
      const fromLid = canonicalizeIdentifier("123456789@lid", mappings);
      const fromPhone = canonicalizeIdentifier("15551234567@s.whatsapp.net", mappings);
      expect(fromLid).toBe(fromPhone);
    });

    it("handles chained mappings (A -> B -> C)", () => {
      const mappings = new Map<string, string>([
        ["aaa", "bbb"],
        ["bbb", "1555"],
        ["1555", "aaa"],
      ]);
      const result = canonicalizeIdentifier("aaa@lid", mappings);
      expect(result).toBe("1555@s.whatsapp.net");
    });

    it("prevents infinite loops on circular mappings", () => {
      const mappings = new Map<string, string>([
        ["x", "y"],
        ["y", "x"],
      ]);
      const result = canonicalizeIdentifier("x@lid", mappings);
      expect(result).toMatch(/@s\.whatsapp\.net$/);
    });

    it("strips non-numeric characters from final result", () => {
      const mappings = new Map<string, string>();
      const result = canonicalizeIdentifier("abc15551234567def@lid", mappings);
      expect(result).toBe("15551234567@s.whatsapp.net");
    });
  });

  describe("getExtensionFromMimeType", () => {
    it("maps common image types", () => {
      expect(getExtensionFromMimeType("image/jpeg")).toBe("jpg");
      expect(getExtensionFromMimeType("image/png")).toBe("png");
    });
    it("maps audio types", () => {
      expect(getExtensionFromMimeType("audio/ogg")).toBe("ogg");
      expect(getExtensionFromMimeType("audio/mpeg")).toBe("mp3");
    });
    it("maps document types", () => {
      expect(getExtensionFromMimeType("application/pdf")).toBe("pdf");
    });
    it("falls back to sub-type for unknown", () => {
      expect(getExtensionFromMimeType("application/foo")).toBe("foo");
    });
  });
});
