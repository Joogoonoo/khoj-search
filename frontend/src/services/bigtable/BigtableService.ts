class BigtableService {
  // Maximum number of rows per table
  constructor() {
    this.MAX_TABLE_SIZE = 1e4;
    this.tables = /* @__PURE__ */ new Map();
    this.initializeDefaultTables();
  }
  initializeDefaultTables() {
    this.createTable("webpages", ["metadata", "content", "links", "ranking"]);
    this.createTable("keywords", ["pages", "stats"]);
    this.createTable("crawl_queue", ["status", "metadata"]);
    this.createTable("user_data", ["search_history", "preferences"]);
  }
  // Table operations
  createTable(name, columnFamilies) {
    if (this.tables.has(name)) {
      throw new Error(`Table ${name} already exists`);
    }
    const table = {
      name,
      rows: /* @__PURE__ */ new Map(),
      columnFamilies
    };
    this.tables.set(name, table);
    console.log(`Table ${name} created with column families: ${columnFamilies.join(", ")}`);
    return table;
  }
  getTable(name) {
    const table = this.tables.get(name);
    if (!table) {
      throw new Error(`Table ${name} does not exist`);
    }
    return table;
  }
  deleteTable(name) {
    return this.tables.delete(name);
  }
  listTables() {
    return Array.from(this.tables.keys());
  }
  // Row operations
  upsertRow(tableName, row) {
    const table = this.getTable(tableName);
    if (table.rows.size >= this.MAX_TABLE_SIZE && !table.rows.has(row.rowKey)) {
      throw new Error(`Table ${tableName} has reached maximum capacity`);
    }
    for (const column in row.columns) {
      const columnFamily = column.split(":")[0];
      if (!table.columnFamilies.includes(columnFamily)) {
        throw new Error(`Column family ${columnFamily} does not exist in table ${tableName}`);
      }
    }
    table.rows.set(row.rowKey, {
      ...row,
      timestamp: row.timestamp || Date.now()
    });
  }
  getRow(tableName, rowKey) {
    const table = this.getTable(tableName);
    return table.rows.get(rowKey);
  }
  deleteRow(tableName, rowKey) {
    const table = this.getTable(tableName);
    return table.rows.delete(rowKey);
  }
  // Query operations
  query(tableName, query) {
    const table = this.getTable(tableName);
    let result = [];
    for (const [rowKey, row] of table.rows.entries()) {
      if (query.prefix && !rowKey.startsWith(query.prefix))
        continue;
      if (query.startKey && rowKey < query.startKey)
        continue;
      if (query.endKey && rowKey > query.endKey)
        continue;
      if (query.columnFamilies || query.columns) {
        const filteredRow = this.filterRowColumns(row, query);
        if (Object.keys(filteredRow.columns).length > 0) {
          result.push(filteredRow);
        }
      } else {
        result.push(row);
      }
      if (query.limit && result.length >= query.limit) {
        break;
      }
    }
    return result;
  }
  filterRowColumns(row, query) {
    const filteredColumns = {};
    for (const [column, cell] of Object.entries(row.columns)) {
      const [columnFamily, columnName] = column.split(":");
      if (query.columnFamilies && !query.columnFamilies.includes(columnFamily)) {
        continue;
      }
      if (query.columns && !query.columns.includes(column)) {
        continue;
      }
      filteredColumns[column] = cell;
    }
    return {
      rowKey: row.rowKey,
      columns: filteredColumns,
      timestamp: row.timestamp
    };
  }
  // Batch operations
  batchUpsert(tableName, rows) {
    rows.forEach((row) => this.upsertRow(tableName, row));
  }
  batchGet(tableName, rowKeys) {
    return rowKeys.map((rowKey) => this.getRow(tableName, rowKey));
  }
  // Statistics
  getTableStats(tableName) {
    const table = this.getTable(tableName);
    let size = 0;
    for (const row of table.rows.values()) {
      size += row.rowKey.length * 2;
      for (const [column, cell] of Object.entries(row.columns)) {
        size += column.length * 2;
        size += JSON.stringify(cell.value).length * 2;
        size += 8;
      }
    }
    return {
      rowCount: table.rows.size,
      size
    };
  }
  // Utility method to clear all data (for testing)
  clearAllData() {
    this.tables.clear();
    this.initializeDefaultTables();
  }
}
export const bigtableService = new BigtableService();

//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkJpZ3RhYmxlU2VydmljZS50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvLyAgS2hvaiBCaWd0YWJsZSAtIE5vU1FMIERhdGFiYXNlIFNlcnZpY2Vcbi8vIEEgc2ltcGxpZmllZCBpbi1tZW1vcnkgaW1wbGVtZW50YXRpb24gb2YgYSBCaWd0YWJsZS1saWtlIGNvbHVtbmFyIGRhdGFiYXNlXG5cbmV4cG9ydCBpbnRlcmZhY2UgQmlndGFibGVSb3cge1xuICByb3dLZXk6IHN0cmluZztcbiAgY29sdW1uczogUmVjb3JkPHN0cmluZywgQmlndGFibGVDZWxsPjtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmlndGFibGVDZWxsIHtcbiAgdmFsdWU6IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBvYmplY3Q7XG4gIHRpbWVzdGFtcDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJpZ3RhYmxlVGFibGUge1xuICBuYW1lOiBzdHJpbmc7XG4gIHJvd3M6IE1hcDxzdHJpbmcsIEJpZ3RhYmxlUm93PjtcbiAgY29sdW1uRmFtaWxpZXM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJpZ3RhYmxlUXVlcnkge1xuICBwcmVmaXg/OiBzdHJpbmc7XG4gIHN0YXJ0S2V5Pzogc3RyaW5nO1xuICBlbmRLZXk/OiBzdHJpbmc7XG4gIGxpbWl0PzogbnVtYmVyO1xuICBjb2x1bW5GYW1pbGllcz86IHN0cmluZ1tdO1xuICBjb2x1bW5zPzogc3RyaW5nW107XG59XG5cbmNsYXNzIEJpZ3RhYmxlU2VydmljZSB7XG4gIHByaXZhdGUgdGFibGVzOiBNYXA8c3RyaW5nLCBCaWd0YWJsZVRhYmxlPjtcbiAgcHJpdmF0ZSByZWFkb25seSBNQVhfVEFCTEVfU0laRSA9IDEwMDAwOyAvLyBNYXhpbXVtIG51bWJlciBvZiByb3dzIHBlciB0YWJsZVxuXG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHRoaXMudGFibGVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuaW5pdGlhbGl6ZURlZmF1bHRUYWJsZXMoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdGlhbGl6ZURlZmF1bHRUYWJsZXMoKSB7XG4gICAgLy8gQ3JlYXRlIGRlZmF1bHQgdGFibGVzIGZvciB0aGUgc2VhcmNoIGVuZ2luZVxuICAgIHRoaXMuY3JlYXRlVGFibGUoJ3dlYnBhZ2VzJywgWydtZXRhZGF0YScsICdjb250ZW50JywgJ2xpbmtzJywgJ3JhbmtpbmcnXSk7XG4gICAgdGhpcy5jcmVhdGVUYWJsZSgna2V5d29yZHMnLCBbJ3BhZ2VzJywgJ3N0YXRzJ10pO1xuICAgIHRoaXMuY3JlYXRlVGFibGUoJ2NyYXdsX3F1ZXVlJywgWydzdGF0dXMnLCAnbWV0YWRhdGEnXSk7XG4gICAgdGhpcy5jcmVhdGVUYWJsZSgndXNlcl9kYXRhJywgWydzZWFyY2hfaGlzdG9yeScsICdwcmVmZXJlbmNlcyddKTtcbiAgfVxuXG4gIC8vIFRhYmxlIG9wZXJhdGlvbnNcbiAgcHVibGljIGNyZWF0ZVRhYmxlKG5hbWU6IHN0cmluZywgY29sdW1uRmFtaWxpZXM6IHN0cmluZ1tdKTogQmlndGFibGVUYWJsZSB7XG4gICAgaWYgKHRoaXMudGFibGVzLmhhcyhuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUYWJsZSAke25hbWV9IGFscmVhZHkgZXhpc3RzYCk7XG4gICAgfVxuXG4gICAgY29uc3QgdGFibGU6IEJpZ3RhYmxlVGFibGUgPSB7XG4gICAgICBuYW1lLFxuICAgICAgcm93czogbmV3IE1hcCgpLFxuICAgICAgY29sdW1uRmFtaWxpZXMsXG4gICAgfTtcblxuICAgIHRoaXMudGFibGVzLnNldChuYW1lLCB0YWJsZSk7XG4gICAgY29uc29sZS5sb2coYFRhYmxlICR7bmFtZX0gY3JlYXRlZCB3aXRoIGNvbHVtbiBmYW1pbGllczogJHtjb2x1bW5GYW1pbGllcy5qb2luKCcsICcpfWApO1xuICAgIHJldHVybiB0YWJsZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRUYWJsZShuYW1lOiBzdHJpbmcpOiBCaWd0YWJsZVRhYmxlIHtcbiAgICBjb25zdCB0YWJsZSA9IHRoaXMudGFibGVzLmdldChuYW1lKTtcbiAgICBpZiAoIXRhYmxlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlICR7bmFtZX0gZG9lcyBub3QgZXhpc3RgKTtcbiAgICB9XG4gICAgcmV0dXJuIHRhYmxlO1xuICB9XG5cbiAgcHVibGljIGRlbGV0ZVRhYmxlKG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnRhYmxlcy5kZWxldGUobmFtZSk7XG4gIH1cblxuICBwdWJsaWMgbGlzdFRhYmxlcygpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy50YWJsZXMua2V5cygpKTtcbiAgfVxuXG4gIC8vIFJvdyBvcGVyYXRpb25zXG4gIHB1YmxpYyB1cHNlcnRSb3codGFibGVOYW1lOiBzdHJpbmcsIHJvdzogQmlndGFibGVSb3cpOiB2b2lkIHtcbiAgICBjb25zdCB0YWJsZSA9IHRoaXMuZ2V0VGFibGUodGFibGVOYW1lKTtcbiAgICBcbiAgICAvLyBFbnN1cmUgdGhlIHRhYmxlIGRvZXNuJ3QgZXhjZWVkIHRoZSBtYXhpbXVtIHNpemVcbiAgICBpZiAodGFibGUucm93cy5zaXplID49IHRoaXMuTUFYX1RBQkxFX1NJWkUgJiYgIXRhYmxlLnJvd3MuaGFzKHJvdy5yb3dLZXkpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRhYmxlICR7dGFibGVOYW1lfSBoYXMgcmVhY2hlZCBtYXhpbXVtIGNhcGFjaXR5YCk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgY29sdW1uIGZhbWlsaWVzXG4gICAgZm9yIChjb25zdCBjb2x1bW4gaW4gcm93LmNvbHVtbnMpIHtcbiAgICAgIGNvbnN0IGNvbHVtbkZhbWlseSA9IGNvbHVtbi5zcGxpdCgnOicpWzBdO1xuICAgICAgaWYgKCF0YWJsZS5jb2x1bW5GYW1pbGllcy5pbmNsdWRlcyhjb2x1bW5GYW1pbHkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29sdW1uIGZhbWlseSAke2NvbHVtbkZhbWlseX0gZG9lcyBub3QgZXhpc3QgaW4gdGFibGUgJHt0YWJsZU5hbWV9YCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGFibGUucm93cy5zZXQocm93LnJvd0tleSwge1xuICAgICAgLi4ucm93LFxuICAgICAgdGltZXN0YW1wOiByb3cudGltZXN0YW1wIHx8IERhdGUubm93KClcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRSb3codGFibGVOYW1lOiBzdHJpbmcsIHJvd0tleTogc3RyaW5nKTogQmlndGFibGVSb3cgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IHRhYmxlID0gdGhpcy5nZXRUYWJsZSh0YWJsZU5hbWUpO1xuICAgIHJldHVybiB0YWJsZS5yb3dzLmdldChyb3dLZXkpO1xuICB9XG5cbiAgcHVibGljIGRlbGV0ZVJvdyh0YWJsZU5hbWU6IHN0cmluZywgcm93S2V5OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCB0YWJsZSA9IHRoaXMuZ2V0VGFibGUodGFibGVOYW1lKTtcbiAgICByZXR1cm4gdGFibGUucm93cy5kZWxldGUocm93S2V5KTtcbiAgfVxuXG4gIC8vIFF1ZXJ5IG9wZXJhdGlvbnNcbiAgcHVibGljIHF1ZXJ5KHRhYmxlTmFtZTogc3RyaW5nLCBxdWVyeTogQmlndGFibGVRdWVyeSk6IEJpZ3RhYmxlUm93W10ge1xuICAgIGNvbnN0IHRhYmxlID0gdGhpcy5nZXRUYWJsZSh0YWJsZU5hbWUpO1xuICAgIGxldCByZXN1bHQ6IEJpZ3RhYmxlUm93W10gPSBbXTtcblxuICAgIGZvciAoY29uc3QgW3Jvd0tleSwgcm93XSBvZiB0YWJsZS5yb3dzLmVudHJpZXMoKSkge1xuICAgICAgLy8gRmlsdGVyIGJ5IGtleSByYW5nZVxuICAgICAgaWYgKHF1ZXJ5LnByZWZpeCAmJiAhcm93S2V5LnN0YXJ0c1dpdGgocXVlcnkucHJlZml4KSkgY29udGludWU7XG4gICAgICBpZiAocXVlcnkuc3RhcnRLZXkgJiYgcm93S2V5IDwgcXVlcnkuc3RhcnRLZXkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHF1ZXJ5LmVuZEtleSAmJiByb3dLZXkgPiBxdWVyeS5lbmRLZXkpIGNvbnRpbnVlO1xuXG4gICAgICAvLyBGaWx0ZXIgYnkgY29sdW1ucyBpZiBzcGVjaWZpZWRcbiAgICAgIGlmIChxdWVyeS5jb2x1bW5GYW1pbGllcyB8fCBxdWVyeS5jb2x1bW5zKSB7XG4gICAgICAgIGNvbnN0IGZpbHRlcmVkUm93ID0gdGhpcy5maWx0ZXJSb3dDb2x1bW5zKHJvdywgcXVlcnkpO1xuICAgICAgICBpZiAoT2JqZWN0LmtleXMoZmlsdGVyZWRSb3cuY29sdW1ucykubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKGZpbHRlcmVkUm93KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzdWx0LnB1c2gocm93KTtcbiAgICAgIH1cblxuICAgICAgLy8gQXBwbHkgbGltaXQgaWYgc3BlY2lmaWVkXG4gICAgICBpZiAocXVlcnkubGltaXQgJiYgcmVzdWx0Lmxlbmd0aCA+PSBxdWVyeS5saW1pdCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBmaWx0ZXJSb3dDb2x1bW5zKHJvdzogQmlndGFibGVSb3csIHF1ZXJ5OiBCaWd0YWJsZVF1ZXJ5KTogQmlndGFibGVSb3cge1xuICAgIGNvbnN0IGZpbHRlcmVkQ29sdW1uczogUmVjb3JkPHN0cmluZywgQmlndGFibGVDZWxsPiA9IHt9O1xuXG4gICAgZm9yIChjb25zdCBbY29sdW1uLCBjZWxsXSBvZiBPYmplY3QuZW50cmllcyhyb3cuY29sdW1ucykpIHtcbiAgICAgIGNvbnN0IFtjb2x1bW5GYW1pbHksIGNvbHVtbk5hbWVdID0gY29sdW1uLnNwbGl0KCc6Jyk7XG5cbiAgICAgIC8vIENoZWNrIGlmIHRoaXMgY29sdW1uIGZhbWlseSBpcyBpbmNsdWRlZFxuICAgICAgaWYgKHF1ZXJ5LmNvbHVtbkZhbWlsaWVzICYmICFxdWVyeS5jb2x1bW5GYW1pbGllcy5pbmNsdWRlcyhjb2x1bW5GYW1pbHkpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiB0aGlzIHNwZWNpZmljIGNvbHVtbiBpcyBpbmNsdWRlZFxuICAgICAgaWYgKHF1ZXJ5LmNvbHVtbnMgJiYgIXF1ZXJ5LmNvbHVtbnMuaW5jbHVkZXMoY29sdW1uKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgZmlsdGVyZWRDb2x1bW5zW2NvbHVtbl0gPSBjZWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICByb3dLZXk6IHJvdy5yb3dLZXksXG4gICAgICBjb2x1bW5zOiBmaWx0ZXJlZENvbHVtbnMsXG4gICAgICB0aW1lc3RhbXA6IHJvdy50aW1lc3RhbXBcbiAgICB9O1xuICB9XG5cbiAgLy8gQmF0Y2ggb3BlcmF0aW9uc1xuICBwdWJsaWMgYmF0Y2hVcHNlcnQodGFibGVOYW1lOiBzdHJpbmcsIHJvd3M6IEJpZ3RhYmxlUm93W10pOiB2b2lkIHtcbiAgICByb3dzLmZvckVhY2gocm93ID0+IHRoaXMudXBzZXJ0Um93KHRhYmxlTmFtZSwgcm93KSk7XG4gIH1cblxuICBwdWJsaWMgYmF0Y2hHZXQodGFibGVOYW1lOiBzdHJpbmcsIHJvd0tleXM6IHN0cmluZ1tdKTogKEJpZ3RhYmxlUm93IHwgdW5kZWZpbmVkKVtdIHtcbiAgICByZXR1cm4gcm93S2V5cy5tYXAocm93S2V5ID0+IHRoaXMuZ2V0Um93KHRhYmxlTmFtZSwgcm93S2V5KSk7XG4gIH1cblxuICAvLyBTdGF0aXN0aWNzXG4gIHB1YmxpYyBnZXRUYWJsZVN0YXRzKHRhYmxlTmFtZTogc3RyaW5nKTogeyByb3dDb3VudDogbnVtYmVyLCBzaXplOiBudW1iZXIgfSB7XG4gICAgY29uc3QgdGFibGUgPSB0aGlzLmdldFRhYmxlKHRhYmxlTmFtZSk7XG4gICAgbGV0IHNpemUgPSAwO1xuXG4gICAgLy8gRXN0aW1hdGUgdGhlIHNpemUgKGluIGJ5dGVzKSBvZiB0aGUgdGFibGVcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiB0YWJsZS5yb3dzLnZhbHVlcygpKSB7XG4gICAgICAvLyBSb3cga2V5IHNpemVcbiAgICAgIHNpemUgKz0gcm93LnJvd0tleS5sZW5ndGggKiAyOyAvLyBBc3N1bWluZyAyIGJ5dGVzIHBlciBjaGFyYWN0ZXJcblxuICAgICAgLy8gQ29sdW1ucyBzaXplXG4gICAgICBmb3IgKGNvbnN0IFtjb2x1bW4sIGNlbGxdIG9mIE9iamVjdC5lbnRyaWVzKHJvdy5jb2x1bW5zKSkge1xuICAgICAgICBzaXplICs9IGNvbHVtbi5sZW5ndGggKiAyOyAvLyBDb2x1bW4gbmFtZVxuICAgICAgICBzaXplICs9IEpTT04uc3RyaW5naWZ5KGNlbGwudmFsdWUpLmxlbmd0aCAqIDI7IC8vIENlbGwgdmFsdWVcbiAgICAgICAgc2l6ZSArPSA4OyAvLyBUaW1lc3RhbXAgKDggYnl0ZXMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHJvd0NvdW50OiB0YWJsZS5yb3dzLnNpemUsXG4gICAgICBzaXplXG4gICAgfTtcbiAgfVxuXG4gIC8vIFV0aWxpdHkgbWV0aG9kIHRvIGNsZWFyIGFsbCBkYXRhIChmb3IgdGVzdGluZylcbiAgcHVibGljIGNsZWFyQWxsRGF0YSgpOiB2b2lkIHtcbiAgICB0aGlzLnRhYmxlcy5jbGVhcigpO1xuICAgIHRoaXMuaW5pdGlhbGl6ZURlZmF1bHRUYWJsZXMoKTtcbiAgfVxufVxuXG4vLyBFeHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXG5leHBvcnQgY29uc3QgYmlndGFibGVTZXJ2aWNlID0gbmV3IEJpZ3RhYmxlU2VydmljZSgpO1xuIFxuIl0sIm1hcHBpbmdzIjoiQUE2QkEsTUFBTSxnQkFBZ0I7QUFBQTtBQUFBLEVBSXBCLGNBQWM7QUFGZCxTQUFpQixpQkFBaUI7QUFHaEMsU0FBSyxT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
