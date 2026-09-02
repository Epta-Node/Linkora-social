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
  SimulationError,
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

    it("preserves SimulationError instance directly", () => {
      const simErr = new SimulationError(
        "Simulation failed",
        undefined,
        undefined,
        "Trap error",
        "ARITH_COUNT"
      );
      const result = mapError(simErr);
      expect(result).toBe(simErr);
      expect(result).toBeInstanceOf(SimulationError);
      expect((result as SimulationError).hostError).toBe("ARITH_COUNT");
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

  describe("NetworkError (unreachable RPC)", () => {
    it("maps an axios ECONNREFUSED error (socket code) to NetworkError", () => {
      const err = new Error("connect ECONNREFUSED 127.0.0.1:8000");
      (err as { code?: string }).code = "ECONNREFUSED";
      const result = mapError(err);
      expect(result).toBeInstanceOf(NetworkError);
      expect(result.code).toBe("NETWORK_ERROR");
      expect(result.originalError).toBe(err);
    });

    it("maps a DNS lookup failure (getaddrinfo ENOTFOUND) to NetworkError", () => {
      const err = new Error("getaddrinfo ENOTFOUND rpc.example.com");
      (err as { code?: string }).code = "ENOTFOUND";
      const result = mapError(err) as NetworkError;
      expect(result).toBeInstanceOf(NetworkError);
      expect(result.originalError).toBe(err);
    });

    it("maps a plain-networked DNS failure string to NetworkError", () => {
      expect(mapError("getaddrinfo ENOTFOUND rpc.example.com")).toBeInstanceOf(NetworkError);
    });

    it("maps a timeout-of-Xms error to NetworkError", () => {
      const err = new Error("timeout of 30000ms exceeded");
      (err as { code?: string }).code = "ECONNABORTED";
      expect(mapError(err)).toBeInstanceOf(NetworkError);
    });

    it("maps 'TypeError: fetch failed' by walking the cause chain", () => {
      const cause = new Error("connect ETIMEDOUT 192.168.0.10:8000");
      (cause as { code?: string }).code = "ETIMEDOUT";
      const err = new TypeError("fetch failed");
      (err as { cause?: unknown }).cause = cause;
      const result = mapError(err) as NetworkError;
      expect(result).toBeInstanceOf(NetworkError);
      expect(result.originalError).toBe(err);
    });

    it("maps an ECONNRESET from an abrupt socket close to NetworkError", () => {
      const err = new Error("read ECONNRESET");
      (err as { code?: string }).code = "ECONNRESET";
      expect(mapError(err)).toBeInstanceOf(NetworkError);
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
