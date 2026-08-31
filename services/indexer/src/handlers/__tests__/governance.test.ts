import {
  handleGovProposalCreated,
  handleGovVote,
  handleGovProposalExecuted,
  handleGovProposalVetoed,
} from "../governance";
import { Database } from "../../db";

jest.mock("../../db");

function makeMockDb(): jest.Mocked<Database> {
  return {
    upsertProfile: jest.fn(),
    insertFollow: jest.fn(),
    deleteFollow: jest.fn(),
    insertPost: jest.fn(),
    markPostDeleted: jest.fn(),
    incrementPostLikeCount: jest.fn(),
    addPostTipTotal: jest.fn(),
    getPost: jest.fn(),
    upsertLike: jest.fn(),
    insertTip: jest.fn(),
    upsertPool: jest.fn(),
    adjustPoolBalance: jest.fn(),
    insertPool: jest.fn(),
    getPool: jest.fn(),
    addPoolAdmin: jest.fn(),
    removePoolAdmin: jest.fn(),
    upsertGovernanceProposal: jest.fn().mockResolvedValue(undefined),
    updateGovernanceProposalStatus: jest.fn().mockResolvedValue(undefined),
    insertGovernanceVote: jest.fn().mockResolvedValue(true),
    listGovernanceProposals: jest.fn(),
    getProfile: jest.fn(),
    listPosts: jest.fn(),
    getFollowers: jest.fn(),
    getFollowing: jest.fn(),
  } as unknown as jest.Mocked<Database>;
}

describe("Governance Event Handlers", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = makeMockDb();
  });

  describe("handleGovProposalCreated", () => {
    it("calls db.upsertGovernanceProposal with the correct parameters", async () => {
      const event = {
        proposal_id: 1n,
        proposer: "GPROPOSER123",
        parameter: "FeeBps",
        new_value: 500n,
        ledger: 100,
      };

      await handleGovProposalCreated(db, event);

      expect(db.upsertGovernanceProposal).toHaveBeenCalledTimes(1);
      expect(db.upsertGovernanceProposal).toHaveBeenCalledWith({
        proposal_id: 1n,
        proposer: "GPROPOSER123",
        parameter: "FeeBps",
        new_value: 500n,
        status: "Active",
        created_ledger: 100,
        updated_ledger: 100,
      });
    });

    it("throws error if required fields are missing", async () => {
      await expect(
        handleGovProposalCreated(db, {
          proposal_id: 0n,
          proposer: "GPROPOSER123",
          parameter: "FeeBps",
          new_value: 500n,
          ledger: 100,
        })
      ).rejects.toThrow("proposal_id");

      await expect(
        handleGovProposalCreated(db, {
          proposal_id: 1n,
          proposer: "",
          parameter: "FeeBps",
          new_value: 500n,
          ledger: 100,
        })
      ).rejects.toThrow("proposer");

      await expect(
        handleGovProposalCreated(db, {
          proposal_id: 1n,
          proposer: "GPROPOSER123",
          parameter: "",
          new_value: 500n,
          ledger: 100,
        })
      ).rejects.toThrow("parameter");
    });
  });

  describe("handleGovVote", () => {
    it("calls db.insertGovernanceVote with the correct parameters", async () => {
      const event = {
        proposal_id: 2n,
        voter: "GVOTER456",
        support: true,
        ledger: 101,
      };

      await handleGovVote(db, event);

      expect(db.insertGovernanceVote).toHaveBeenCalledTimes(1);
      expect(db.insertGovernanceVote).toHaveBeenCalledWith({
        proposal_id: 2n,
        voter: "GVOTER456",
        support: true,
        ledger: 101,
      });
    });

    it("throws error if required fields are missing", async () => {
      await expect(
        handleGovVote(db, {
          proposal_id: 0n,
          voter: "GVOTER456",
          support: true,
          ledger: 101,
        })
      ).rejects.toThrow("proposal_id");

      await expect(
        handleGovVote(db, {
          proposal_id: 2n,
          voter: "",
          support: true,
          ledger: 101,
        })
      ).rejects.toThrow("voter");
    });
  });

  describe("handleGovProposalExecuted", () => {
    it("calls db.updateGovernanceProposalStatus with correct status", async () => {
      const event = {
        proposal_id: 3n,
        parameter: "FeeBps",
        new_value: 600n,
        ledger: 105,
      };

      await handleGovProposalExecuted(db, event);

      expect(db.updateGovernanceProposalStatus).toHaveBeenCalledTimes(1);
      expect(db.updateGovernanceProposalStatus).toHaveBeenCalledWith(3n, "Executed", 105);
    });

    it("throws error if proposal_id is missing", async () => {
      await expect(
        handleGovProposalExecuted(db, {
          proposal_id: 0n,
          parameter: "FeeBps",
          new_value: 600n,
          ledger: 105,
        })
      ).rejects.toThrow("proposal_id");
    });
  });

  describe("handleGovProposalVetoed", () => {
    it("calls db.updateGovernanceProposalStatus with Vetoed status", async () => {
      const event = {
        proposal_id: 4n,
        ledger: 110,
      };

      await handleGovProposalVetoed(db, event);

      expect(db.updateGovernanceProposalStatus).toHaveBeenCalledTimes(1);
      expect(db.updateGovernanceProposalStatus).toHaveBeenCalledWith(4n, "Vetoed", 110);
    });

    it("throws error if proposal_id is missing", async () => {
      await expect(
        handleGovProposalVetoed(db, {
          proposal_id: 0n,
          ledger: 110,
        })
      ).rejects.toThrow("proposal_id");
    });
  });
});
