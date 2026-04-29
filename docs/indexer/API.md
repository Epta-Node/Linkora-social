# Indexer API Contract

## Search Endpoint

### POST /api/search/posts

Search posts by keyword content.

#### Request

```json
{
  "query": "string",
  "limit": 20,
  "offset": 0
}
```

**Parameters:**
- `query` (required): Search keywords to match against post content
- `limit` (optional): Maximum number of results to return (default: 20, max: 100)
- `offset` (optional): Number of results to skip for pagination (default: 0)

#### Response

```json
{
  "posts": [
    {
      "id": "u64",
      "author": "string",
      "content": "string",
      "tip_total": "string",
      "timestamp": "u64"
    }
  ],
  "total": "number",
  "has_more": "boolean"
}
```

**Response Fields:**
- `posts`: Array of matching posts
- `total`: Total number of matching posts
- `has_more`: Whether there are more results available

#### Error Response

```json
{
  "error": "string",
  "code": "string"
}
```

**Error Codes:**
- `INVALID_QUERY`: Query parameter is missing or invalid
- `LIMIT_EXCEEDED`: Limit parameter exceeds maximum allowed value
- `INTERNAL_ERROR`: Server error occurred during search
