/** Initial GraphQL contract for the indexer's read-only query surface. */
export const indexerTypeDefs = `#graphql
  scalar DateTime

  type Profile { address: ID!, username: String!, creatorToken: String }
  type Post { id: ID!, author: Profile!, content: String!, createdAt: DateTime! }
  type Pool { id: ID!, token: String!, balance: String!, admins: [String!]! }
  type Tip { id: ID!, post: Post!, tipper: String!, amount: String!, createdAt: DateTime! }
  type Event { id: ID!, type: String!, ledger: Int!, createdAt: DateTime!, payload: String! }

  type Query {
    profile(address: ID!): Profile
    post(id: ID!): Post
    pool(id: ID!): Pool
    tips(postId: ID!, limit: Int = 20): [Tip!]!
    events(cursor: String, limit: Int = 50): [Event!]!
  }
`;
