'use client';

import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv, type ReportTable } from '@/lib/calc/reports';

/** Builds the CSV in the browser from the table already on the page: no extra request. */
export function DownloadCsvButton({ table, filename }: { table: ReportTable; filename: string }) {
  const download = () => {
    // The BOM makes Excel read the file as UTF-8 (names with accents, the en dash…).
    const blob = new Blob(['﻿', toCsv(table)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" className="h-11 gap-2 print:hidden" onClick={download} disabled={table.rows.length === 0}>
      <Download className="size-4" aria-hidden /> CSV
    </Button>
  );
}

/** Print, or "Save as PDF" from the phone's print dialog. The app's menus are hidden in print. */
export function PrintButton() {
  return (
    <Button variant="outline" className="h-11 gap-2 print:hidden" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden /> Print / PDF
    </Button>
  );
}
