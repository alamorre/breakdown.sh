'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const routeLabels: Record<string, string> = {
  '/docs': 'Docs',
  '/docs/codex-plugin': 'Codex Plugin',
  '/docs/deployment': 'Deployment And Secrets',
  '/docs/getting-started': 'Getting Started',
  '/docs/google-drive': 'Google Drive Sources',
  '/docs/product': 'Product Model',
  '/mcp': 'MCP Access',
};

function titleCaseSegment(segment: string) {
  return segment
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function getBreadcrumbItems(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  const items: Array<{ href?: string; label: string }> = [{ href: '/', label: 'breakdown.sh' }];

  if (normalizedPath === '/mcp') {
    return [...items, { href: '/docs', label: 'Docs' }, { label: routeLabels['/mcp'] }];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  let href = '';

  for (const [index, segment] of segments.entries()) {
    href += `/${segment}`;
    const isCurrent = index === segments.length - 1;
    items.push({
      href: isCurrent ? undefined : href,
      label: routeLabels[href] ?? titleCaseSegment(segment),
    });
  }

  return items;
}

export function DocsBreadcrumb() {
  const pathname = usePathname();
  const items = getBreadcrumbItems(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem>
                {isCurrent ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <Link
                    href={item.href ?? '/'}
                    className="transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </Link>
                )}
              </BreadcrumbItem>
              {!isCurrent && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
