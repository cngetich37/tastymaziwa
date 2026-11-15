import { CalendarCheck, HandCoins, Users, Wallet } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { AddEmployeeButton, AttendanceToggle, EmployeeActions } from '@/components/people-panels';
import { StatCard } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { formatLongDate, todayBusinessDate } from '@/lib/dates';
import { formatKES } from '@/lib/money';
import { OWNER } from '@/lib/roles';
import { listEmployees, type EmployeeItem } from '@/server/queries';
import { requireUser } from '@/server/session';

export const metadata = { title: 'Staff · TastyMaziwa' };

const pay = (e: EmployeeItem) => `${formatKES(e.rateCents)} / ${e.payType === 'daily' ? 'day' : 'month'}`;

/** The team: who is in today, days worked this month, and advances still owed. */
export default async function StaffPage() {
  const user = await requireUser(OWNER);
  const today = todayBusinessDate();
  const staff = await listEmployees(await getDb(), user.shopId, today);
  const active = staff.filter((e) => e.active);
  const present = active.filter((e) => e.presentToday).length;
  const advances = staff.reduce((n, e) => n + e.advancesCents, 0);
  const dayWages = active.filter((e) => e.payType === 'daily').reduce((n, e) => n + e.daysThisMonth * e.rateCents, 0);

  const columns: Column<EmployeeItem>[] = [
    {
      key: 'name',
      header: 'Name',
      primary: true,
      cell: (e) => (
        <span className="flex flex-wrap items-center gap-2">
          {e.name}
          {!e.active && <Badge variant="secondary">Left</Badge>}
          {e.statutory && <Badge variant="outline">Formal</Badge>}
        </span>
      ),
    },
    { key: 'pay', header: 'Pay', cell: pay },
    { key: 'days', header: 'Days this month', align: 'right', cell: (e) => e.daysThisMonth },
    {
      key: 'advances',
      header: 'Advances owed',
      align: 'right',
      cell: (e) => (e.advancesCents ? formatKES(e.advancesCents) : '—'),
    },
    { key: 'phone', header: 'Phone', hideOnMobile: true, cell: (e) => e.phone ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (e) => (
        <EmployeeActions
          active={e.active}
          employee={{
            id: e.id,
            name: e.name,
            phone: e.phone,
            payType: e.payType,
            rateCents: e.rateCents,
            startDate: e.startDate,
            statutory: e.statutory,
            kraPin: e.kraPin,
            nssfNumber: e.nssfNumber,
            shaNumber: e.shaNumber,
          }}
        />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Staff" description="Your team, attendance and advances." actions={<AddEmployeeButton />} />

      <section aria-label="Team figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="On the team" value={String(active.length)} icon={Users} />
        <StatCard label="In today" value={`${present} of ${active.length}`} icon={CalendarCheck} />
        <StatCard label="Day wages so far" value={formatKES(dayWages)} icon={Wallet} detail="This month, before advances" />
        <StatCard label="Advances owed" value={formatKES(advances)} icon={HandCoins} tone={advances ? 'warning' : 'default'} />
      </section>

      {active.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Who is in today?</CardTitle>
            <CardDescription>{formatLongDate(today)} · tap to mark present. Day workers are paid per day marked.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul aria-label="Attendance today" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((e) => (
                <li key={e.id}>
                  <AttendanceToggle employeeId={e.id} name={e.name} present={e.presentToday} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            label="Staff"
            columns={columns}
            rows={staff}
            rowKey={(e) => e.id}
            empty="Add the people who work in the shop to track their days and pay."
          />
        </CardContent>
      </Card>
    </div>
  );
}
