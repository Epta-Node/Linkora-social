import {
  LinkoraError,
  NotFoundError,
  UnauthorizedError,
  InsufficientBalanceError,
  CooldownError,
  InvalidInputError,
  ValidationError,
  NetworkError,
  SigningError,
  ContractError,
  mapError,
} from "../errors";

describe("Error classes", () => {
  it("LinkoraError sets name, message, and code correctly", () => {
    const err = new LinkoraError("Something went wrong");
    expect(err.message).toBe("Something went wrong");
    expect(err.name).toBe("LinkoraError");
    expect(err.code).toBe("LINKORA_ERROR");
    expect(err.originalError).toBeUndefined();
    expect(err.details).toBeUndefined();
  });

  it("LinkoraError preserves original error and details", () => {
    const original = new Error("network failure");
    const err = new LinkoraError("SDK error", "CUSTOM_CODE", { foo: "bar" }, original);
    expect(err.originalError).toBe(original);
    expect(err.details).toEqual({ foo: "bar" });
    expect(err.code).toBe("CUSTOM_CODE");
  });

  it("NotFoundError has correct code and is instanceof LinkoraError", () => {
    const err = new NotFoundError("not found");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.name).toBe("NotFoundError");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("UnauthorizedError has correct code", () => {
    const err = new UnauthorizedError("unauthorized");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("InsufficientBalanceError has correct code", () => {
    const err = new InsufficientBalanceError("low balance");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("CooldownError has correct code", () => {
    const err = new CooldownError("cooldown active");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err.code).toBe("COOLDOWN_ACTIVE");
  });

  it("InvalidInputError has correct code", () => {
    const err = new InvalidInputError("bad input");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err.code).toBe("INVALID_INPUT");
  });

  it("ValidationError has correct code and carries details", () => {
    const err = new ValidationError("field too long", { field: "username", max: 32 });
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe("ValidationError");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toEqual({ field: "username", max: 32 });
  });

  it("NetworkError has correct code and carries details", () => {
    const err = new NetworkError("connection refused", { status: 503 });
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toBe("NetworkError");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.details).toEqual({ status: 503 });
  });

  it("SigningError has correct code and carries details", () => {
    const err = new SigningError("user rejected", { reason: "user_rejected" });
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err).toBeInstanceOf(SigningError);
    expect(err.name).toBe("SigningError");
    expect(err.code).toBe("SIGNING_ERROR");
    expect(err.details).toEqual({ reason: "user_rejected" });
  });

  it("ContractError has correct code", () => {
    const err = new ContractError("simulation trapped");
    expect(err).toBeInstanceOf(LinkoraError);
    expect(err).toBeInstanceOf(ContractError);
    expect(err.name).toBe("ContractError");
    expect(err.code).toBe("CONTRACT_ERROR");
  });

  it("supports instanceof checks in compiled output", () => {
    const err = new NotFoundError("test");
    expect(Object.getPrototypeOf(err)).toBe(NotFoundError.prototype);
  });
});

describe("mapError", () => {
  describe("NotFoundError", () => {
    it("matches 'not found'", () => {
      const result = mapError("resource not found");
      expect(result).toBeInstanceOf(NotFoundError);
      expect(result.message).toBe("The requested resource was not found.");
    });

    it("matches 'does not exist'", () => {
      expect(mapError("post does not exist")).toBeInstanceOf(NotFoundError);
    });

    it("preserves the original error", () => {
      const original = new Error("not found");
      const result = mapError(original) as NotFoundError;
      expect(result).toBeInstanceOf(NotFoundError);
      expect(result.originalError).toBe(original);
    });
  });

  describe("UnauthorizedError", () => {
    it("matches 'unauthorized'", () => {
      const result = mapError("unauthorized action");
      expect(result).toBeInstanceOf(UnauthorizedError);
      expect(result.message).toBe("Unauthorized operation. You do not have permission.");
    });

    it("matches 'only author'", () => {
      expect(mapError("only author can edit")).toBeInstanceOf(UnauthorizedError);
    });

    it("matches 'blocked'", () => {
      const result = mapError("user has blocked you");
      expect(result).toBeInstanceOf(UnauthorizedError);
      expect(result.message).toBe("Operation rejected: user has blocked you.");
    });
  });

  describe("InsufficientBalanceError", () => {
    it("matches 'insufficient allowance'", () => {
      expect(mapError("insufficient allowance")).toBeInstanceOf(InsufficientBalanceError);
    });

    it("matches 'low balance'", () => {
      expect(mapError("low balance")).toBeInstanceOf(InsufficientBalanceError);
    });
  });

  describe("CooldownError", () => {
    it("matches 'cooldown'", () => {
      expect(mapError("cooldown period not expired")).toBeInstanceOf(CooldownError);
    });
  });

  describe("ValidationError", () => {
    it("matches 'invalid'", () => {
      const result = mapError("invalid username");
      expect(result).toBeInstanceOf(ValidationError);
      expect(result.message).toContain("invalid username");
    });

    it("matches 'too long'", () => {
      expect(mapError("content too long")).toBeInstanceOf(ValidationError);
    });

    it("matches 'must be positive'", () => {
      expect(mapError("amount must be positive")).toBeInstanceOf(ValidationError);
    });
  });

  describe("ContractError", () => {
    it("matches 'simulation failed'", () => {
      expect(mapError("simulation failed for contract")).toBeInstanceOf(ContractError);
    });

    it("matches 'host function'", () => {
      expect(mapError("host function invocation failed")).toBeInstanceOf(ContractError);
    });
  });

  describe("NetworkError", () => {
    it("matches 'connection'", () => {
      expect(mapError("ECONNREFUSED 127.0.0.1:8000")).toBeInstanceOf(NetworkError);
    });

    it("matches 'timeout'", () => {
      expect(mapError("request timeout")).toBeInstanceOf(NetworkError);
    });
  });

  describe("SigningError", () => {
    it("matches 'freighter'", () => {
      expect(mapError("freighter extension not found")).toBeInstanceOf(SigningError);
    });

    it("matches 'ledger'", () => {
      expect(mapError("ledger device not connected")).toBeInstanceOf(SigningError);
    });
  });

  describe("default fallback", () => {
    it("returns LinkoraError for unknown errors", () => {
      const result = mapError("something unexpected happened");
      expect(result).toBeInstanceOf(LinkoraError);
      expect(result).not.toBeInstanceOf(NotFoundError);
      expect(result.message).toBe("something unexpected happened");
    });

    it("handles Error objects", () => {
      expect(mapError(new Error("custom runtime error"))).toBeInstanceOf(LinkoraError);
    });
  });
});
