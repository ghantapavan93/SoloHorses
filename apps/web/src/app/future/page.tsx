import { redirect } from 'next/navigation';

/** The page moved: what came next is now the vision, in the story's own register. */
export default function FuturePage() {
  redirect('/vision');
}
