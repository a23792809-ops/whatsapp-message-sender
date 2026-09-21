import React from 'react';
import Link from 'next/link';
import { Upload, PlusCircle, Send, MessageSquare, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

export function QuickActions() {
  const actions = [
    {
      title: 'Upload Customers',
      description: 'Import Bharat Gas consumer records from CSV / Excel spreadsheet',
      icon: Upload,
      href: '/customers',
      color: 'bg-blue-50 text-[#007BC9] border-blue-200 group-hover:bg-blue-100',
    },
    {
      title: 'Create Template',
      description: 'Draft personalized WhatsApp messages with custom consumer variables',
      icon: PlusCircle,
      href: '/templates',
      color: 'bg-yellow-50 text-[#998a00] border-yellow-200 group-hover:bg-yellow-100',
    },
    {
      title: 'Create Campaign',
      description: 'Launch scheduled or throttled refill broadcasts to consumer batches',
      icon: Send,
      href: '/campaigns',
      color: 'bg-blue-50 text-[#007BC9] border-blue-200 group-hover:bg-blue-100',
    },
    {
      title: 'View Messages',
      description: 'Inspect full WhatsApp dispatch logs, delivery statuses and error logs',
      icon: MessageSquare,
      href: '/messages',
      color: 'bg-slate-100 text-slate-700 border-slate-200 group-hover:bg-slate-200',
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Quick Operational Actions</CardTitle>
        <CardDescription>Direct workflows to initiate Bharat Gas customer communications</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {actions.map((act) => {
            const Icon = act.icon;
            return (
              <Link
                key={act.title}
                href={act.href}
                className="group p-4 rounded-xl border border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-50/40 transition-all flex items-start gap-3.5 shadow-2xs hover:shadow-sm"
              >
                <div className={`p-2.5 rounded-lg border ${act.color} shrink-0 transition-colors`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold text-[#212529] group-hover:text-[#007BC9] transition-colors">
                      {act.title}
                    </h4>
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-[#007BC9] group-hover:translate-x-0.5 transition-all" />
                  </div>
                  <p className="text-sm text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                    {act.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
