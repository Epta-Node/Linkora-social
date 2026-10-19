-- Migration 009: governance tables
--
-- Stores on-chain governance proposals and votes.

CREATE TABLE IF NOT EXISTS governance_proposals (
    proposal_id      BIGINT        NOT NULL PRIMARY KEY,
    proposer         TEXT          NOT NULL,
    parameter        TEXT          NOT NULL,
    new_value        NUMERIC(20,0) NOT NULL,
    votes_for        BIGINT        NOT NULL DEFAULT 0,
    votes_against    BIGINT        NOT NULL DEFAULT 0,
    status           TEXT          NOT NULL, -- 'Active', 'Passed', 'Executed', 'Vetoed', 'Failed'
    created_ledger   INTEGER       NOT NULL,
    updated_ledger   INTEGER       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_governance_proposals_status ON governance_proposals (status);
CREATE INDEX IF NOT EXISTS idx_governance_proposals_proposer ON governance_proposals (proposer);

CREATE TABLE IF NOT EXISTS governance_votes (
    proposal_id      BIGINT        NOT NULL,
    voter            TEXT          NOT NULL,
    support          BOOLEAN       NOT NULL,
    ledger           INTEGER       NOT NULL,
    PRIMARY KEY (proposal_id, voter)
);

CREATE INDEX IF NOT EXISTS idx_governance_votes_proposal ON governance_votes (proposal_id);
