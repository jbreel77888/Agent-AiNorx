import { redirect } from 'next/navigation';

export default function AdminAccessRequestsRedirect() {
  redirect('/admin/accounts');
}
