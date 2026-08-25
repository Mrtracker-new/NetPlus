import { describe, it, expect } from "vitest";
import { extractLocationFromHostname } from "../geo/observedHostnameClassifier";

describe("Observed Hostname Classifier (100% Offline Token-Boundary Matching)", () => {
  it("extracts city and country from delimiter-separated IATA edge codes", () => {
    // Frankfurt (FRA)
    const resFra = extractLocationFromHostname("fra-edge-01.example.net");
    expect(resFra).not.toBeNull();
    expect(resFra?.city).toBe("Frankfurt");
    expect(resFra?.countryCode).toBe("DE");
    expect(resFra?.iataCode).toBe("FRA");

    // London (LHR)
    const resLhr = extractLocationFromHostname("edge01.lhr.cdn.net");
    expect(resLhr).not.toBeNull();
    expect(resLhr?.city).toBe("London");
    expect(resLhr?.countryCode).toBe("GB");

    // Tokyo (NRT)
    const resNrt = extractLocationFromHostname("server_nrt_99.internal.com");
    expect(resNrt).not.toBeNull();
    expect(resNrt?.city).toBe("Tokyo");
    expect(resNrt?.countryCode).toBe("JP");

    // Singapore (SIN)
    const resSin = extractLocationFromHostname("sin1-pop.anycast.io");
    expect(resSin).not.toBeNull();
    expect(resSin?.city).toBe("Singapore");
    expect(resSin?.countryCode).toBe("SG");

    // Sydney (SYD)
    const resSyd = extractLocationFromHostname("gw-syd.au.telecom.com");
    expect(resSyd).not.toBeNull();
    expect(resSyd?.city).toBe("Sydney");
    expect(resSyd?.countryCode).toBe("AU");
  });

  it("strictly rejects false positive substring matches across English and brand words", () => {
    // "fraud" contains "fra" but has no token boundary
    expect(extractLocationFromHostname("myfraudserver.company.com")).toBeNull();
    expect(extractLocationFromHostname("anti-fraud-service.org")).toBeNull();

    // "sinister" contains "sin" but has no token boundary
    expect(extractLocationFromHostname("sinistercorp.net")).toBeNull();

    // "delivery" or "deliver" contains "del"
    expect(extractLocationFromHostname("delivery-node.shop.com")).toBeNull();

    // "dulles" contains "iad" (no match) or "dul" (no match without token)
    expect(extractLocationFromHostname("industrial-machinery.net")).toBeNull();

    // "ordinary" contains "ord" but without token boundary
    expect(extractLocationFromHostname("extraordinary-domain.org")).toBeNull();

    // Random non-matching hostnames
    expect(extractLocationFromHostname("google.com")).toBeNull();
    expect(extractLocationFromHostname("ec2-54-210-0-1.compute-1.amazonaws.com")).toBeNull();
  });

  it("never returns physical coordinates in GeoHint", () => {
    const res = extractLocationFromHostname("ord-router-01.backbone.net");
    expect(res).not.toBeNull();
    expect((res as any).latitude).toBeUndefined();
    expect((res as any).longitude).toBeUndefined();
    expect((res as any).mapEligible).toBeUndefined();
  });
});
