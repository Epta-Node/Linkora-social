import { classifyTipError, toBaseUnits, trimAmount, validateTipAmount } from "../tipValidation";

const XLM = { balance: "12.5000000", decimals: 7, symbol: "XLM" };

describe("toBaseUnits", () => {
  it("converts decimal strings exactly", () => {
    expect(toBaseUnits("1", 7)).toBe(10_000_000n);
    expect(toBaseUnits("0.0000001", 7)).toBe(1n);
    expect(toBaseUnits("12.5000000", 7)).toBe(125_000_000n);
  });

  it("rejects malformed values and excess precision", () => {
    expect(toBaseUnits("1.", 7)).toBeNull();
    expect(toBaseUnits("-1", 7)).toBeNull();
    expect(toBaseUnits("1e3", 7)).toBeNull();
    expect(toBaseUnits("0.00000001", 7)).toBeNull();
  });
});

describe("validateTipAmount", () => {
  it("requires a token and an amount", () => {
    expect(validateTipAmount("1", null)).toBe("Select a token to tip with.");
    expect(validateTipAmount("", XLM)).toBe("Enter an amount.");
    expect(validateTipAmount("abc", XLM)).toBe("Enter a valid number.");
  });

  it("enforces the token's decimals", () => {
    expect(validateTipAmount("1.00000001", XLM)).toBe("XLM supports at most 7 decimal places.");
    expect(validateTipAmount("1.5", { ...XLM, decimals: 0, symbol: "PTS" })).toBe(
      "PTS supports at most 0 decimal places."
    );
  });

  it("rejects zero and amounts above the balance, comparing base units exactly", () => {
    expect(validateTipAmount("0", XLM)).toBe("Amount must be greater than 0.");
    expect(validateTipAmount("12.5000001", XLM)).toBe("Insufficient balance — you have 12.5 XLM.");
    expect(validateTipAmount("12.5", XLM)).toBeNull();
    expect(validateTipAmount("0.0000001", XLM)).toBeNull();
  });
});

describe("trimAmount", () => {
  it("drops trailing zeros only after a decimal point", () => {
    expect(trimAmount("100.0000000")).toBe("100");
    expect(trimAmount("100.5000000")).toBe("100.5");
    expect(trimAmount("100")).toBe("100");
  });
});

describe("classifyTipError", () => {
  it("explains the tip cooldown (TIP_CD_W) instead of a raw contract error", () => {
    const expected = /tipped this post with this token recently/;
    expect(classifyTipError(new Error("HostError: Error(Contract, #126)"))).toMatch(expected);
    expect(classifyTipError(new Error("TipCooldownActive"))).toMatch(expected);
    expect(classifyTipError("tip cooldown window still active")).toMatch(expected);
  });

  it("falls back to the shared transaction classifier", () => {
    expect(classifyTipError(new Error("User rejected the request"))).toBe(
      "Transaction rejected by wallet"
    );
    expect(classifyTipError(new Error("Error(Contract, #12)"))).toBe("Error(Contract, #12)");
  });
});
