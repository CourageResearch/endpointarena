import { sql } from 'drizzle-orm'
import { AdminConsoleLayout } from '@/components/AdminConsoleLayout'
import { redirectIfNotAdmin } from '@/lib/admin-auth'
import { db } from '@/lib/db'
import { getActiveDatabaseTarget, listDatabaseTargets } from '@/lib/database-target'

export const dynamic = 'force-dynamic'

type TableMetadataRow = {
  tableSchema: string
  tableName: string
  columnCount: number
  estimatedRows: string
  totalSize: string
}

type TableColumnRow = {
  tableSchema: string
  tableName: string
  ordinalPosition: number
  columnName: string
  dataType: string
  isNullable: 'YES' | 'NO'
  columnDefault: string | null
  isPrimaryKey: boolean
}

type TableDetails = TableMetadataRow & {
  columns: TableColumnRow[]
}

function formatInteger(value: string): string {
  try {
    return BigInt(value).toLocaleString('en-US')
  } catch {
    return value
  }
}

async function getTableDetails(): Promise<TableDetails[]> {
  const [rawTableRows, rawColumnRows] = await Promise.all([
    db.execute(sql<TableMetadataRow>`
      select
        tables.table_schema as "tableSchema",
        tables.table_name as "tableName",
        coalesce(column_counts.column_count, 0)::int as "columnCount",
        coalesce(stats.n_live_tup, 0)::bigint::text as "estimatedRows",
        pg_size_pretty(
          pg_total_relation_size(
            format('%I.%I', tables.table_schema, tables.table_name)::regclass
          )
        ) as "totalSize"
      from information_schema.tables as tables
      left join (
        select
          table_schema,
          table_name,
          count(*)::int as column_count
        from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
        group by table_schema, table_name
      ) as column_counts
        on column_counts.table_schema = tables.table_schema
       and column_counts.table_name = tables.table_name
      left join pg_stat_user_tables as stats
        on stats.schemaname = tables.table_schema
       and stats.relname = tables.table_name
      where tables.table_type = 'BASE TABLE'
        and tables.table_schema not in ('pg_catalog', 'information_schema')
      order by tables.table_schema asc, tables.table_name asc
    `),
    db.execute(sql<TableColumnRow>`
      select
        columns.table_schema as "tableSchema",
        columns.table_name as "tableName",
        columns.ordinal_position::int as "ordinalPosition",
        columns.column_name as "columnName",
        case
          when columns.data_type = 'USER-DEFINED' then columns.udt_name
          else columns.data_type
        end as "dataType",
        columns.is_nullable as "isNullable",
        columns.column_default as "columnDefault",
        exists (
          select 1
          from information_schema.table_constraints as constraints
          inner join information_schema.key_column_usage as keys
            on constraints.constraint_name = keys.constraint_name
           and constraints.table_schema = keys.table_schema
           and constraints.table_name = keys.table_name
          where constraints.constraint_type = 'PRIMARY KEY'
            and constraints.table_schema = columns.table_schema
            and constraints.table_name = columns.table_name
            and keys.column_name = columns.column_name
        ) as "isPrimaryKey"
      from information_schema.columns as columns
      where columns.table_schema not in ('pg_catalog', 'information_schema')
      order by
        columns.table_schema asc,
        columns.table_name asc,
        columns.ordinal_position asc
    `),
  ])
  const tableRows = rawTableRows as unknown as TableMetadataRow[]
  const columnRows = rawColumnRows as unknown as TableColumnRow[]

  const columnsByTable = new Map<string, TableColumnRow[]>()
  for (const column of columnRows) {
    const key = `${column.tableSchema}.${column.tableName}`
    const existing = columnsByTable.get(key)
    if (existing) {
      existing.push(column)
    } else {
      columnsByTable.set(key, [column])
    }
  }

  return tableRows.map((table) => ({
    ...table,
    columns: columnsByTable.get(`${table.tableSchema}.${table.tableName}`) ?? [],
  }))
}

export default async function AdminTablesPage() {
  await redirectIfNotAdmin('/admin/tables')
  const tables = await getTableDetails()
  const activeTarget = getActiveDatabaseTarget()
  const activeDatabase = listDatabaseTargets().find((entry) => entry.target === activeTarget) ?? null
  const totalColumns = tables.reduce((sum, table) => sum + table.columnCount, 0)

  return (
    <AdminConsoleLayout
      title="Tables"
      activeTab="tables"
    >
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#1a1a1a]">{tables.length.toLocaleString('en-US')}</div>
            <div className="text-xs text-[#8a8075]">Base Tables</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-3">
            <div className="text-2xl font-bold text-[#1a1a1a]">{totalColumns.toLocaleString('en-US')}</div>
            <div className="text-xs text-[#8a8075]">Columns Across Tables</div>
          </div>
          <div className="rounded-none border border-[#e8ddd0] bg-white/80 p-3">
            <div className="text-lg font-bold text-[#1a1a1a]">{activeDatabase?.label ?? 'Unknown DB'}</div>
            <div className="text-xs text-[#8a8075]">{activeDatabase?.databaseName ?? 'Current runtime target'}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-[#8a8075]">
          Showing live Postgres metadata for the currently active runtime database target. Row counts are approximate and come from Postgres stats.
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Tables</h2>
          <p className="text-xs text-[#b5aa9e]">Open any table to inspect its columns</p>
        </div>

        <div className="overflow-hidden rounded-none border border-[#e8ddd0] bg-white/80">
          {tables.length === 0 ? (
            <div className="p-4 text-sm text-[#8a8075]">No user tables were found in this database.</div>
          ) : (
            <div className="divide-y divide-[#e8ddd0]">
              {tables.map((table) => (
                <details key={`${table.tableSchema}.${table.tableName}`} className="group">
                  <summary className="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 marker:hidden transition-colors hover:bg-[#f8f4ee] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-[#1a1a1a]">{table.tableName}</h3>
                        <span className="rounded-none border border-[#e8ddd0] bg-[#fcfaf7] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[#8a8075]">
                          {table.tableSchema}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#8a8075]">
                        {table.columnCount.toLocaleString('en-US')} columns
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:min-w-[280px]">
                      <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Approx Rows</div>
                        <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{formatInteger(table.estimatedRows)}</div>
                      </div>
                      <div className="rounded-none border border-[#e8ddd0] bg-white px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.08em] text-[#8a8075]">Total Size</div>
                        <div className="mt-1 text-sm font-medium text-[#1a1a1a]">{table.totalSize}</div>
                      </div>
                    </div>
                  </summary>

                  <div className="border-t border-[#e8ddd0] bg-[#fcfaf7] p-4">
                    <div className="overflow-x-auto rounded-none border border-[#e8ddd0] bg-white">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#e8ddd0]">
                            <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">#</th>
                            <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Column</th>
                            <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Type</th>
                            <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Nullable</th>
                            <th className="px-4 py-2 text-left text-[10px] font-medium uppercase tracking-[0.2em] text-[#b5aa9e]">Default</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.columns.map((column) => (
                            <tr key={`${table.tableName}.${column.columnName}`} className="border-b border-[#e8ddd0] last:border-b-0">
                              <td className="px-4 py-2 text-xs text-[#8a8075]">{column.ordinalPosition}</td>
                              <td className="px-4 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-xs text-[#1a1a1a]">{column.columnName}</span>
                                  {column.isPrimaryKey ? (
                                    <span className="rounded-none bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-white">
                                      PK
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-[#8a8075]">{column.dataType}</td>
                              <td className="px-4 py-2 text-xs text-[#8a8075]">{column.isNullable === 'YES' ? 'Yes' : 'No'}</td>
                              <td className="px-4 py-2 font-mono text-xs text-[#8a8075]">
                                {column.columnDefault?.trim() || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </AdminConsoleLayout>
  )
}
