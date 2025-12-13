import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Rooms',
  description: 'Terms of Service for Rooms encrypted chat',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-gray-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
          <a href="/" className="text-gray-400 hover:text-white text-sm">← Back</a>
        </div>
        
        <p className="text-gray-400 text-sm">Last updated: December 13, 2025</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Acceptance</h2>
          <p className="text-gray-300">By using Rooms, you agree to these terms. Don't like them? Don't use it.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Prohibited Use</h2>
          <p className="text-gray-300">You may NOT use this service for:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Illegal activities of any kind</li>
            <li>Drug deals, weapons sales, or black market transactions</li>
            <li>Child exploitation or abuse</li>
            <li>Terrorism or violence coordination</li>
            <li>Harassment, threats, or stalking</li>
            <li>Fraud or scams</li>
            <li>Sharing stolen content or credentials</li>
            <li>Any activity that violates local, state, or federal law</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">What We Do About It</h2>
          <p className="text-gray-300">Since we can't read your messages (they're encrypted), we rely on:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>You being a decent human</li>
            <li>Law enforcement with proper warrants</li>
            <li>Community reports</li>
          </ul>
          <p className="text-gray-300">If illegal activity is suspected and we're contacted by authorities, we'll comply with legal requests.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">No Warranty</h2>
          <p className="text-gray-300">This service is provided "as is":</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Messages may fail to send</li>
            <li>Storage may fail</li>
            <li>Encryption may have bugs</li>
            <li>We make NO guarantees</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Liability</h2>
          <p className="text-gray-300">We're not liable for:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Lost messages</li>
            <li>Security breaches</li>
            <li>Illegal content shared by users</li>
            <li>Any damages whatsoever</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Age Requirement</h2>
          <p className="text-gray-300">You must be 13+ to use this service.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Termination</h2>
          <p className="text-gray-300">We can shut this down anytime. Your data is in your browser anyway.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Jurisdiction</h2>
          <p className="text-gray-300">These terms are governed by US law.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Your Responsibility</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>You control what you share</li>
            <li>You're responsible for your content</li>
            <li>You must follow applicable laws</li>
            <li>Keep your room codes private</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Reporting</h2>
          <p className="text-gray-300">If you see something concerning, contact local authorities. We can't read messages, but law enforcement can request cooperation.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Changes</h2>
          <p className="text-gray-300">We may update these terms. Check back occasionally.</p>
        </section>

        <section className="space-y-4 border-t border-gray-800 pt-8">
          <h2 className="text-xl font-semibold text-white">No Illegal Content Policy</h2>
          <p className="text-gray-300">We have zero tolerance for illegal content. While we can't monitor encrypted messages, any reported or discovered illegal use will result in:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Cooperation with law enforcement</li>
            <li>Service termination</li>
            <li>Legal action if necessary</li>
          </ul>
          <p className="text-gray-300 font-semibold">Don't be stupid. Don't break the law.</p>
        </section>

        <div className="flex justify-center gap-6 text-sm text-gray-600 pt-8 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400">Home</a>
          <a href="/privacy" className="hover:text-gray-400">Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}
