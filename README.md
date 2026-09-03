# VMM Export Service

This microservice queries the app-vmm database to find codelist mapping annotations, as well as their reviews, and converts that data into a JSON format for export.

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `PAGE_SIZE` | `1000` | Number of annotations per page when the client does not pass `size`. |
| `MAX_PAGE_SIZE` | `5000` | Upper bound on the `size` a client may request. |
| `LOG_LEVEL` | | Set to `debug` to log the duration of every query. |

## API

### GET /export

Returns a page of annotations.

| Query parameter | Default | Description |
| --- | --- | --- |
| `since` | | ISO 8601 datetime. Only include annotations created at or after this moment. When omitted, everything is exported. |
| `minApproved` | `0` | Only include annotations with at least this many approving reviews. |
| `minRejected` | `0` | Only include annotations with at least this many rejecting reviews. |
| `minCorrections` | `0` | Only include annotations with at least this many corrections. |
| `page` | `0` | Zero-based page number. |
| `size` | `PAGE_SIZE` | Number of annotations per page. |

```json
{
  "data": [ ... ],
  "meta": {
    "count": 1000,
    "total": 2500,
    "page": 0,
    "size": 1000,
    "pages": 3
  },
  "links": {
    "self": "/export?page=0&size=1000",
    "next": "/export?page=1&size=1000",
    "prev": null
  }
}
```

Requesting a page beyond the last one returns an empty `data` array rather than a 404. An invalid parameter returns a `400` with an `errors` array.
