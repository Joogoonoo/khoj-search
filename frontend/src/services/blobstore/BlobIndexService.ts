import { blobstoreService } from "/src/services/blobstore/BlobstoreService.ts";
import { bigtableService } from "/src/services/bigtable/BigtableService.ts";
export class BlobIndexService {
  constructor() {
    this.BLOB_INDEX_TABLE = "blob_index";
    this.MAX_KEY_SIZE = 256;
    this.initializeIndexTable();
  }
  initializeIndexTable() {
    try {
      bigtableService.getTable(this.BLOB_INDEX_TABLE);
    } catch (error) {
      bigtableService.createTable(this.BLOB_INDEX_TABLE, ["metadata", "index", "content"]);
    }
  }
  // Store and index a blob
  async storeBlob(key, data, contentType, tags = {}, indexedFields = {}) {
    if (key.length > this.MAX_KEY_SIZE) {
      throw new Error(`कुंजी बहुत लंबी है। अधिकतम आकार: ${this.MAX_KEY_SIZE}`);
    }
    const metadata = await blobstoreService.storeBlob(key, data, contentType, tags);
    const indexedMetadata = {
      ...metadata,
      indexedFields
    };
    this.indexBlobMetadata(indexedMetadata);
    return indexedMetadata;
  }
  // Index blob metadata in Bigtable
  indexBlobMetadata(metadata) {
    const rowKey = metadata.key;
    const row = {
      rowKey,
      timestamp: Date.now(),
      columns: {
        "metadata:contentType": { value: metadata.contentType, timestamp: Date.now() },
        "metadata:size": { value: metadata.size, timestamp: Date.now() },
        "metadata:createdAt": { value: metadata.createdAt, timestamp: Date.now() },
        "metadata:checksum": { value: metadata.checksum || "", timestamp: Date.now() }
      }
    };
    Object.entries(metadata.tags).forEach(([tagName, tagValue]) => {
      row.columns[`metadata:tag_${tagName}`] = { value: tagValue, timestamp: Date.now() };
    });
    if (metadata.indexedFields) {
      Object.entries(metadata.indexedFields).forEach(([fieldName, fieldValue]) => {
        row.columns[`index:${fieldName}`] = {
          value: typeof fieldValue === "object" ? JSON.stringify(fieldValue) : fieldValue,
          timestamp: Date.now()
        };
      });
    }
    if (metadata.indexedFields?.keywords) {
      const keywords = metadata.indexedFields.keywords;
      if (Array.isArray(keywords)) {
        row.columns["content:keywords"] = { value: keywords.join(","), timestamp: Date.now() };
      }
    }
    bigtableService.upsertRow(this.BLOB_INDEX_TABLE, row);
  }
  // Search for blobs using Bigtable for efficient queries
  searchBlobs(query, options = {}) {
    try {
      const rows = bigtableService.query(this.BLOB_INDEX_TABLE, {
        limit: options.limit || 100
      });
      const results = rows.filter((row) => {
        for (const [field, value] of Object.entries(query)) {
          const columnKey = `index:${field}`;
          if (!row.columns[columnKey]) {
            return false;
          }
          const indexedValue = row.columns[columnKey].value;
          if (typeof value === "object" && value !== null) {
            if (value.$gt !== void 0 && indexedValue <= value.$gt)
              return false;
            if (value.$lt !== void 0 && indexedValue >= value.$lt)
              return false;
            if (value.$eq !== void 0 && indexedValue !== value.$eq)
              return false;
            if (value.$ne !== void 0 && indexedValue === value.$ne)
              return false;
            if (value.$in !== void 0 && !value.$in.includes(indexedValue))
              return false;
          } else if (indexedValue !== value) {
            return false;
          }
        }
        return true;
      });
      return results.map((row) => this.rowToIndexedMetadata(row));
    } catch (error) {
      console.error("Error searching blobs:", error);
      return [];
    }
  }
  // Get a blob with its indexed metadata
  getBlob(key) {
    const blob = blobstoreService.getBlob(key);
    if (!blob) {
      return null;
    }
    try {
      const row = bigtableService.getRow(this.BLOB_INDEX_TABLE, key);
      if (row) {
        const indexedMetadata = this.rowToIndexedMetadata(row);
        return {
          metadata: indexedMetadata,
          data: blob.data
        };
      }
    } catch (error) {
      console.error(`Error getting indexed metadata for blob ${key}:`, error);
    }
    return {
      metadata: blob.metadata,
      data: blob.data
    };
  }
  // Delete a blob and its index
  deleteBlob(key) {
    try {
      bigtableService.deleteRow(this.BLOB_INDEX_TABLE, key);
      return blobstoreService.deleteBlob(key);
    } catch (error) {
      console.error(`Error deleting blob ${key}:`, error);
      return false;
    }
  }
  // Update indexed metadata
  updateIndexedMetadata(key, tags, indexedFields) {
    try {
      const row = bigtableService.getRow(this.BLOB_INDEX_TABLE, key);
      if (!row) {
        return null;
      }
      const existingMetadata = this.rowToIndexedMetadata(row);
      if (tags) {
        blobstoreService.updateBlobMetadata(key, { tags });
      }
      const updatedMetadata = {
        ...existingMetadata,
        tags: tags || existingMetadata.tags,
        indexedFields: {
          ...existingMetadata.indexedFields,
          ...indexedFields
        }
      };
      this.indexBlobMetadata(updatedMetadata);
      return updatedMetadata;
    } catch (error) {
      console.error(`Error updating indexed metadata for blob ${key}:`, error);
      return null;
    }
  }
  // Convert a Bigtable row to IndexedBlobMetadata
  rowToIndexedMetadata(row) {
    const metadata = {
      key: row.rowKey,
      contentType: row.columns["metadata:contentType"]?.value || "application/octet-stream",
      size: Number(row.columns["metadata:size"]?.value) || 0,
      createdAt: Number(row.columns["metadata:createdAt"]?.value) || Date.now(),
      checksum: row.columns["metadata:checksum"]?.value,
      tags: {},
      indexedFields: {}
    };
    for (const [column, cell] of Object.entries(row.columns)) {
      if (column.startsWith("metadata:tag_")) {
        const tagName = column.substring("metadata:tag_".length);
        metadata.tags[tagName] = cell.value;
      }
    }
    for (const [column, cell] of Object.entries(row.columns)) {
      if (column.startsWith("index:")) {
        const fieldName = column.substring("index:".length);
        let value = cell.value;
        if (typeof value === "string" && (value.startsWith("{") && value.endsWith("}") || value.startsWith("[") && value.endsWith("]"))) {
          try {
            value = JSON.parse(value);
          } catch (e) {
          }
        }
        metadata.indexedFields[fieldName] = value;
      }
    }
    return metadata;
  }
  // Get statistics
  getStats() {
    const blobStats = blobstoreService.getStats();
    let indexStats = { rowCount: 0, size: 0 };
    try {
      indexStats = bigtableService.getTableStats(this.BLOB_INDEX_TABLE);
    } catch (error) {
      console.error("Error getting index stats:", error);
    }
    return {
      blobCount: blobStats.count,
      totalSize: blobStats.totalSize,
      availableSize: blobStats.availableSize,
      indexedCount: indexStats.rowCount
    };
  }
}
export const blobIndexService = new BlobIndexService();

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkJsb2JJbmRleFNlcnZpY2UudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICB7IGJsb2JzdG9yZVNlcnZpY2UsIEJsb2JNZXRhZGF0YSwgQmxvYlF1ZXJ5T3B0aW9ucyB9IGZyb20gJy4vQmxvYnN0b3JlU2VydmljZSc7XG5pbXBvcnQgeyBiaWd0YWJsZVNlcnZpY2UsIEJpZ3RhYmxlUm93IH0gZnJvbSAnLi4vYmlndGFibGUvQmlndGFibGVTZXJ2aWNlJztcblxuLy8gSW50ZXJmYWNlIGZvciBibG9iIG9wZXJhdGlvbnMgd2l0aCBpbmRleGluZ1xuZXhwb3J0IGludGVyZmFjZSBJbmRleGVkQmxvYk1ldGFkYXRhIGV4dGVuZHMgQmxvYk1ldGFkYXRhIHtcbiAgaW5kZXhlZEZpZWxkcz86IFJlY29yZDxzdHJpbmcsIGFueT47XG59XG5cbmV4cG9ydCBjbGFzcyBCbG9iSW5kZXhTZXJ2aWNlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBCTE9CX0lOREVYX1RBQkxFID0gJ2Jsb2JfaW5kZXgnO1xuICBwcml2YXRlIHJlYWRvbmx5IE1BWF9LRVlfU0laRSA9IDI1NjtcbiAgXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMuaW5pdGlhbGl6ZUluZGV4VGFibGUoKTtcbiAgfVxuICBcbiAgcHJpdmF0ZSBpbml0aWFsaXplSW5kZXhUYWJsZSgpIHtcbiAgICB0cnkge1xuICAgICAgYmlndGFibGVTZXJ2aWNlLmdldFRhYmxlKHRoaXMuQkxPQl9JTkRFWF9UQUJMRSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIFRhYmxlIGRvZXNuJ3QgZXhpc3QsIGNyZWF0ZSBpdFxuICAgICAgYmlndGFibGVTZXJ2aWNlLmNyZWF0ZVRhYmxlKHRoaXMuQkxPQl9JTkRFWF9UQUJMRSwgWydtZXRhZGF0YScsICdpbmRleCcsICdjb250ZW50J10pO1xuICAgIH1cbiAgfVxuICBcbiAgLy8gU3RvcmUgYW5kIGluZGV4IGEgYmxvYlxuICBwdWJsaWMgYXN5bmMgc3RvcmVCbG9iKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGRhdGE6IEFycmF5QnVmZmVyIHwgQmxvYiB8IEZpbGUsXG4gICAgY29udGVudFR5cGU6IHN0cmluZyxcbiAgICB0YWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge30sXG4gICAgaW5kZXhlZEZpZWxkczogUmVjb3JkPHN0cmluZywgYW55PiA9IHt9XG4gICk6IFByb21pc2U8SW5kZXhlZEJsb2JNZXRhZGF0YT4ge1xuICAgIC8vIFZhbGlkYXRlIGtleSBzaXplXG4gICAgaWYgKGtleS5sZW5ndGggPiB0aGlzLk1BWF9LRVlfU0laRSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGDgpJXgpYHgpILgpJzgpYAg4KSs4KS54KWB4KSkIOCksuCkguCkrOClgCDgpLngpYjgpaQg4KSF4KSn4KS/4KSV4KSk4KSuIOCkhuCkleCkvuCksDogJHt0aGlzLk1BWF9LRVlfU0laRX1gKTtcbiAgICB9XG4gICAgXG4gICAgLy8gU3RvcmUgYmxvYiBpbiBibG9ic3RvcmVcbiAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IGJsb2JzdG9yZVNlcnZpY2Uuc3RvcmVCbG9iKGtleSwgZGF0YSwgY29udGVudFR5cGUsIHRhZ3MpO1xuICAgIFxuICAgIC8vIENyZWF0ZSBpbmRleGluZyBpbmZvcm1hdGlvblxuICAgIGNvbnN0IGluZGV4ZWRNZXRhZGF0YTogSW5kZXhlZEJsb2JNZXRhZGF0YSA9IHtcbiAgICAgIC4uLm1ldGFkYXRhLFxuICAgICAgaW5kZXhlZEZpZWxkc1xuICAgIH07XG4gICAgXG4gICAgLy8gU3RvcmUgbWV0YWRhdGEgaW4gQmlndGFibGUgZm9yIGluZGV4aW5nXG4gICAgdGhpcy5pbmRleEJsb2JNZXRhZGF0YShpbmRleGVkTWV0YWRhdGEpO1xuICAgIFxuICAgIHJldHVybiBpbmRleGVkTWV0YWRhdGE7XG4gIH1cbiAgXG4gIC8vIEluZGV4IGJsb2IgbWV0YWRhdGEgaW4gQmlndGFibGVcbiAgcHJpdmF0ZSBpbmRleEJsb2JNZXRhZGF0YShtZXRhZGF0YTogSW5kZXhlZEJsb2JNZXRhZGF0YSk6IHZvaWQge1xuICAgIGNvbnN0IHJvd0tleSA9IG1ldGFkYXRhLmtleTtcbiAgICBcbiAgICAvLyBQcmVwYXJlIHRoZSByb3cgZGF0YSBmb3IgQmlndGFibGVcbiAgICBjb25zdCByb3c6IEJpZ3RhYmxlUm93ID0ge1xuICAgICAgcm93S2V5LFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgY29sdW1uczoge1xuICAgICAgICAnbWV0YWRhdGE6Y29udGVudFR5cGUnOiB7IHZhbHVlOiBtZXRhZGF0YS5jb250ZW50VHlwZSwgdGltZXN0YW1wOiBEYXRlLm5vdygpIH0sXG4gICAgICAgICdtZXRhZGF0YTpzaXplJzogeyB2YWx1ZTogbWV0YWRhdGEuc2l6ZSwgdGltZXN0YW1wOiBEYXRlLm5vdygpIH0sXG4gICAgICAgICdtZXRhZGF0YTpjcmVhdGVkQXQnOiB7IHZhbHVlOiBtZXRhZGF0YS5jcmVhdGVkQXQsIHRpbWVzdGFtcDogRGF0ZS5ub3coKSB9LFxuICAgICAgICAnbWV0YWRhdGE6Y2hlY2tzdW0nOiB7IHZhbHVlOiBtZXRhZGF0YS5jaGVja3N1bSB8fCAnJywgdGltZXN0YW1wOiBEYXRlLm5vdygpIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIC8vIEFkZCB0YWdzIGFzIGNvbHVtbnNcbiAgICBPYmplY3QuZW50cmllcyhtZXRhZGF0YS50YWdzKS5mb3JFYWNoKChbdGFnTmFtZSwgdGFnVmFsdWVdKSA9PiB7XG4gICAgICByb3cuY29sdW1uc1tgbWV0YWRhdGE6dGFnXyR7dGFnTmFtZX1gXSA9IHsgdmFsdWU6IHRhZ1ZhbHVlLCB0aW1lc3RhbXA6IERhdGUubm93KCkgfTtcbiAgICB9KTtcbiAgICBcbiAgICAvLyBBZGQgaW5kZXhlZCBmaWVsZHMgZm9yIHNlYXJjaGFiaWxpdHlcbiAgICBpZiAobWV0YWRhdGEuaW5kZXhlZEZpZWxkcykge1xuICAgICAgT2JqZWN0LmVudHJpZXMobWV0YWRhdGEuaW5kZXhlZEZpZWxkcykuZm9yRWFjaCgoW2ZpZWxkTmFtZSwgZmllbGRWYWx1ZV0pID0+IHtcbiAgICAgICAgcm93LmNvbHVtbnNbYGluZGV4OiR7ZmllbGROYW1lfWBdID0geyBcbiAgICAgICAgICB2YWx1ZTogdHlwZW9mIGZpZWxkVmFsdWUgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZSkgOiBmaWVsZFZhbHVlLCBcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCkgXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICB9XG4gICAgXG4gICAgLy8gQWRkIGNvbnRlbnQga2V5d29yZHMgaWYgYXZhaWxhYmxlXG4gICAgaWYgKG1ldGFkYXRhLmluZGV4ZWRGaWVsZHM/LmtleXdvcmRzKSB7XG4gICAgICBjb25zdCBrZXl3b3JkcyA9IG1ldGFkYXRhLmluZGV4ZWRGaWVsZHMua2V5d29yZHM7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShrZXl3b3JkcykpIHtcbiAgICAgICAgcm93LmNvbHVtbnNbJ2NvbnRlbnQ6a2V5d29yZHMnXSA9IHsgdmFsdWU6IGtleXdvcmRzLmpvaW4oJywnKSwgdGltZXN0YW1wOiBEYXRlLm5vdygpIH07XG4gICAgICB9XG4gICAgfVxuICAgIFxuICAgIC8vIFN0b3JlIGluIEJpZ3RhYmxlXG4gICAgYmlndGFibGVTZXJ2aWNlLnVwc2VydFJvdyh0aGlzLkJMT0JfSU5ERVhfVEFCTEUsIHJvdyk7XG4gIH1cbiAgXG4gIC8vIFNlYXJjaCBmb3IgYmxvYnMgdXNpbmcgQmlndGFibGUgZm9yIGVmZmljaWVudCBxdWVyaWVzXG4gIHB1YmxpYyBzZWFyY2hCbG9icyhxdWVyeTogUmVjb3JkPHN0cmluZywgYW55Piwgb3B0aW9uczogQmxvYlF1ZXJ5T3B0aW9ucyA9IHt9KTogSW5kZXhlZEJsb2JNZXRhZGF0YVtdIHtcbiAgICB0cnkge1xuICAgICAgLy8gR2V0IGFsbCBibG9iIG1ldGFkYXRhIHJvd3MgZnJvbSBCaWd0YWJsZVxuICAgICAgY29uc3Qgcm93cyA9IGJpZ3RhYmxlU2VydmljZS5xdWVyeSh0aGlzLkJMT0JfSU5ERVhfVEFCTEUsIHtcbiAgICAgICAgbGltaXQ6IG9wdGlvbnMubGltaXQgfHwgMTAwXG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gRmlsdGVyIHJvd3MgYmFzZWQgb24gcXVlcnkgY3JpdGVyaWFcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSByb3dzLmZpbHRlcihyb3cgPT4ge1xuICAgICAgICBmb3IgKGNvbnN0IFtmaWVsZCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHF1ZXJ5KSkge1xuICAgICAgICAgIGNvbnN0IGNvbHVtbktleSA9IGBpbmRleDoke2ZpZWxkfWA7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gU2tpcCBpZiB0aGlzIGZpZWxkIHdhc24ndCBpbmRleGVkXG4gICAgICAgICAgaWYgKCFyb3cuY29sdW1uc1tjb2x1bW5LZXldKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICAgIFxuICAgICAgICAgIGNvbnN0IGluZGV4ZWRWYWx1ZSA9IHJvdy5jb2x1bW5zW2NvbHVtbktleV0udmFsdWU7XG4gICAgICAgICAgXG4gICAgICAgICAgLy8gSGFuZGxlIGRpZmZlcmVudCBjb21wYXJpc29uIHR5cGVzXG4gICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIGlmICh2YWx1ZS4kZ3QgIT09IHVuZGVmaW5lZCAmJiBpbmRleGVkVmFsdWUgPD0gdmFsdWUuJGd0KSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBpZiAodmFsdWUuJGx0ICE9PSB1bmRlZmluZWQgJiYgaW5kZXhlZFZhbHVlID49IHZhbHVlLiRsdCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgaWYgKHZhbHVlLiRlcSAhPT0gdW5kZWZpbmVkICYmIGluZGV4ZWRWYWx1ZSAhPT0gdmFsdWUuJGVxKSByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICBpZiAodmFsdWUuJG5lICE9PSB1bmRlZmluZWQgJiYgaW5kZXhlZFZhbHVlID09PSB2YWx1ZS4kbmUpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIGlmICh2YWx1ZS4kaW4gIT09IHVuZGVmaW5lZCAmJiAhdmFsdWUuJGluLmluY2x1ZGVzKGluZGV4ZWRWYWx1ZSkpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGluZGV4ZWRWYWx1ZSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9KTtcbiAgICAgIFxuICAgICAgLy8gQ29udmVydCByb3dzIHRvIEluZGV4ZWRCbG9iTWV0YWRhdGFcbiAgICAgIHJldHVybiByZXN1bHRzLm1hcChyb3cgPT4gdGhpcy5yb3dUb0luZGV4ZWRNZXRhZGF0YShyb3cpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2VhcmNoaW5nIGJsb2JzOicsIGVycm9yKTtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gIH1cbiAgXG4gIC8vIEdldCBhIGJsb2Igd2l0aCBpdHMgaW5kZXhlZCBtZXRhZGF0YVxuICBwdWJsaWMgZ2V0QmxvYihrZXk6IHN0cmluZyk6IHsgbWV0YWRhdGE6IEluZGV4ZWRCbG9iTWV0YWRhdGEsIGRhdGE6IEFycmF5QnVmZmVyIH0gfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIGJsb2IgZnJvbSBibG9ic3RvcmVcbiAgICBjb25zdCBibG9iID0gYmxvYnN0b3JlU2VydmljZS5nZXRCbG9iKGtleSk7XG4gICAgXG4gICAgaWYgKCFibG9iKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgXG4gICAgLy8gR2V0IGluZGV4ZWQgbWV0YWRhdGEgZnJvbSBCaWd0YWJsZVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByb3cgPSBiaWd0YWJsZVNlcnZpY2UuZ2V0Um93KHRoaXMuQkxPQl9JTkRFWF9UQUJMRSwga2V5KTtcbiAgICAgIFxuICAgICAgaWYgKHJvdykge1xuICAgICAgICBjb25zdCBpbmRleGVkTWV0YWRhdGEgPSB0aGlzLnJvd1RvSW5kZXhlZE1ldGFkYXRhKHJvdyk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgbWV0YWRhdGE6IGluZGV4ZWRNZXRhZGF0YSxcbiAgICAgICAgICBkYXRhOiBibG9iLmRhdGFcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZ2V0dGluZyBpbmRleGVkIG1ldGFkYXRhIGZvciBibG9iICR7a2V5fTpgLCBlcnJvcik7XG4gICAgfVxuICAgIFxuICAgIC8vIEZhbGwgYmFjayB0byBqdXN0IHRoZSBiYXNpYyBtZXRhZGF0YSBpZiBpbmRleCBub3QgZm91bmRcbiAgICByZXR1cm4ge1xuICAgICAgbWV0YWRhdGE6IGJsb2IubWV0YWRhdGEsXG4gICAgICBkYXRhOiBibG9iLmRhdGFcbiAgICB9O1xuICB9XG4gIFxuICAvLyBEZWxldGUgYSBibG9iIGFuZCBpdHMgaW5kZXhcbiAgcHVibGljIGRlbGV0ZUJsb2Ioa2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICB0cnkge1xuICAgICAgLy8gRGVsZXRlIGZyb20gQmlndGFibGUgaW5kZXhcbiAgICAgIGJpZ3RhYmxlU2VydmljZS5kZWxldGVSb3codGhpcy5CTE9CX0lOREVYX1RBQkxFLCBrZXkpO1xuICAgICAgXG4gICAgICAvLyBEZWxldGUgZnJvbSBibG9ic3RvcmVcbiAgICAgIHJldHVybiBibG9ic3RvcmVTZXJ2aWNlLmRlbGV0ZUJsb2Ioa2V5KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgYmxvYiAke2tleX06YCwgZXJyb3IpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuICBcbiAgLy8gVXBkYXRlIGluZGV4ZWQgbWV0YWRhdGFcbiAgcHVibGljIHVwZGF0ZUluZGV4ZWRNZXRhZGF0YShcbiAgICBrZXk6IHN0cmluZywgXG4gICAgdGFncz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgaW5kZXhlZEZpZWxkcz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogSW5kZXhlZEJsb2JNZXRhZGF0YSB8IG51bGwge1xuICAgIHRyeSB7XG4gICAgICAvLyBGaXJzdCBnZXQgdGhlIGV4aXN0aW5nIG1ldGFkYXRhXG4gICAgICBjb25zdCByb3cgPSBiaWd0YWJsZVNlcnZpY2UuZ2V0Um93KHRoaXMuQkxPQl9JTkRFWF9UQUJMRSwga2V5KTtcbiAgICAgIGlmICghcm93KSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBleGlzdGluZ01ldGFkYXRhID0gdGhpcy5yb3dUb0luZGV4ZWRNZXRhZGF0YShyb3cpO1xuICAgICAgXG4gICAgICAvLyBVcGRhdGUgYmxvYnN0b3JlIG1ldGFkYXRhXG4gICAgICBpZiAodGFncykge1xuICAgICAgICBibG9ic3RvcmVTZXJ2aWNlLnVwZGF0ZUJsb2JNZXRhZGF0YShrZXksIHsgdGFncyB9KTtcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gVXBkYXRlIHRoZSBpbmRleGVkIG1ldGFkYXRhXG4gICAgICBjb25zdCB1cGRhdGVkTWV0YWRhdGE6IEluZGV4ZWRCbG9iTWV0YWRhdGEgPSB7XG4gICAgICAgIC4uLmV4aXN0aW5nTWV0YWRhdGEsXG4gICAgICAgIHRhZ3M6IHRhZ3MgfHwgZXhpc3RpbmdNZXRhZGF0YS50YWdzLFxuICAgICAgICBpbmRleGVkRmllbGRzOiB7XG4gICAgICAgICAgLi4uZXhpc3RpbmdNZXRhZGF0YS5pbmRleGVkRmllbGRzLFxuICAgICAgICAgIC4uLmluZGV4ZWRGaWVsZHNcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIFxuICAgICAgLy8gUmUtaW5kZXggaW4gQmlndGFibGVcbiAgICAgIHRoaXMuaW5kZXhCbG9iTWV0YWRhdGEodXBkYXRlZE1ldGFkYXRhKTtcbiAgICAgIFxuICAgICAgcmV0dXJuIHVwZGF0ZWRNZXRhZGF0YTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgaW5kZXhlZCBtZXRhZGF0YSBmb3IgYmxvYiAke2tleX06YCwgZXJyb3IpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG4gIFxuICAvLyBDb252ZXJ0IGEgQmlndGFibGUgcm93IHRvIEluZGV4ZWRCbG9iTWV0YWRhdGFcbiAgcHJpdmF0ZSByb3dUb0luZGV4ZWRNZXRhZGF0YShyb3c6IEJpZ3RhYmxlUm93KTogSW5kZXhlZEJsb2JNZXRhZGF0YSB7XG4gICAgY29uc3QgbWV0YWRhdGE6IEluZGV4ZWRCbG9iTWV0YWRhdGEgPSB7XG4gICAgICBrZXk6IHJvdy5yb3dLZXksXG4gICAgICBjb250ZW50VHlwZTogcm93LmNvbHVtbnNbJ21ldGFkYXRhOmNvbnRlbnRUeXBlJ10/LnZhbHVlIGFzIHN0cmluZyB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgIHNpemU6IE51bWJlcihyb3cuY29sdW1uc1snbWV0YWRhdGE6c2l6ZSddPy52YWx1ZSkgfHwgMCxcbiAgICAgIGNyZWF0ZWRBdDogTnVtYmVyKHJvdy5jb2x1bW5zWydtZXRhZGF0YTpjcmVhdGVkQXQnXT8udmFsdWUpIHx8IERhdGUubm93KCksXG4gICAgICBjaGVja3N1bTogcm93LmNvbHVtbnNbJ21ldGFkYXRhOmNoZWNrc3VtJ10/LnZhbHVlIGFzIHN0cmluZyxcbiAgICAgIHRhZ3M6IHt9LFxuICAgICAgaW5kZXhlZEZpZWxkczoge31cbiAgICB9O1xuICAgIFxuICAgIC8vIEV4dHJhY3QgdGFnc1xuICAgIGZvciAoY29uc3QgW2NvbHVtbiwgY2VsbF0gb2YgT2JqZWN0LmVudHJpZXMocm93LmNvbHVtbnMpKSB7XG4gICAgICBpZiAoY29sdW1uLnN0YXJ0c1dpdGgoJ21ldGFkYXRhOnRhZ18nKSkge1xuICAgICAgICBjb25zdCB0YWdOYW1lID0gY29sdW1uLnN1YnN0cmluZygnbWV0YWRhdGE6dGFnXycubGVuZ3RoKTtcbiAgICAgICAgbWV0YWRhdGEudGFnc1t0YWdOYW1lXSA9IGNlbGwudmFsdWUgYXMgc3RyaW5nO1xuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBFeHRyYWN0IGluZGV4ZWQgZmllbGRzXG4gICAgZm9yIChjb25zdCBbY29sdW1uLCBjZWxsXSBvZiBPYmplY3QuZW50cmllcyhyb3cuY29sdW1ucykpIHtcbiAgICAgIGlmIChjb2x1bW4uc3RhcnRzV2l0aCgnaW5kZXg6JykpIHtcbiAgICAgICAgY29uc3QgZmllbGROYW1lID0gY29sdW1uLnN1YnN0cmluZygnaW5kZXg6Jy5sZW5ndGgpO1xuICAgICAgICBsZXQgdmFsdWUgPSBjZWxsLnZhbHVlO1xuICAgICAgICBcbiAgICAgICAgLy8gVHJ5IHRvIHBhcnNlIEpTT04gaWYgaXQgbG9va3MgbGlrZSBKU09OXG4gICAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmIFxuICAgICAgICAgICAgKCh2YWx1ZS5zdGFydHNXaXRoKCd7JykgJiYgdmFsdWUuZW5kc1dpdGgoJ30nKSkgfHwgXG4gICAgICAgICAgICAgKHZhbHVlLnN0YXJ0c1dpdGgoJ1snKSAmJiB2YWx1ZS5lbmRzV2l0aCgnXScpKSkpIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgdmFsdWUgPSBKU09OLnBhcnNlKHZhbHVlKTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAvLyBLZWVwIGFzIHN0cmluZyBpZiBwYXJzaW5nIGZhaWxzXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBtZXRhZGF0YS5pbmRleGVkRmllbGRzW2ZpZWxkTmFtZV0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIG1ldGFkYXRhO1xuICB9XG4gIFxuICAvLyBHZXQgc3RhdGlzdGljc1xuICBwdWJsaWMgZ2V0U3RhdHMoKSB7XG4gICAgY29uc3QgYmxvYlN0YXRzID0gYmxvYnN0b3JlU2VydmljZS5nZXRTdGF0cygpO1xuICAgIGxldCBpbmRleFN0YXRzID0geyByb3dDb3VudDogMCwgc2l6ZTogMCB9O1xuICAgIFxuICAgIHRyeSB7XG4gICAgICBpbmRleFN0YXRzID0gYmlndGFibGVTZXJ2aWNlLmdldFRhYmxlU3RhdHModGhpcy5CTE9CX0lOREVYX1RBQkxFKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyBpbmRleCBzdGF0czonLCBlcnJvcik7XG4gICAgfVxuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBibG9iQ291bnQ6IGJsb2JTdGF0cy5jb3VudCxcbiAgICAgIHRvdGFsU2l6ZTogYmxvYlN0YXRzLnRvdGFsU2l6ZSxcbiAgICAgIGF2YWlsYWJsZVNpemU6IGJsb2JTdGF0cy5hdmFpbGFibGVTaXplLFxuICAgICAgaW5kZXhlZENvdW50OiBpbmRleFN0YXRzLnJvd0NvdW50XG4gICAgfTtcbiAgfVxufVxuXG4vLyBFeHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXG5leHBvcnQgY29uc3QgYmxvYkluZGV4U2VydmljZSA9IG5ldyBCbG9iSW5kZXhTZXJ2aWNlKCk7XG4gXG4iXSwibWFwcGluZ3MiOiJBQUFBLFNBQVUsd0JBQXdEO0FBQ2xFLFNBQVMsdUJBQW9DO0FBT3RDLGFBQU0saUJBQWlCO0FBQUEsRUFJNUIsY0FBYztBQUhkLFNBQWlCLG1CQUFtQjtBQUNwQyxTQUFpQixlQUFlO0FBRzlCLFNBQUsscUJBQXFCO0FBQUEsRUFDNUI7QUFBQSxFQUVRLHVCQUF1QjtBQUM3QixRQUFJO0FBQ0Ysc0JBQWdCLFNBQVMsS0FBSyxnQkFBZ0I7QUFBQSxJQUNoRCxTQUFTLE9BQU87QUFFZCxzQkFBZ0IsWUFBWSxLQUFLLGtCQUFrQixDQUFD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
