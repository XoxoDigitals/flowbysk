import { redirect } from 'next/navigation';

export default function CharactersRedirect() {
  redirect('/dashboard/library');
}
