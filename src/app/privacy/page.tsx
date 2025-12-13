import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - Rooms',
  description: 'Privacy Policy for Rooms encrypted chat',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-gray-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
          <a href="/" className="text-gray-400 hover:text-white text-sm">← Back</a>
        </div>
        
        <p className="text-gray-400 text-sm">Last updated: December 13, 2025</p>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Data Collection</h2>
          <p className="text-gray-300 text-lg font-semibold">We collect ZERO data. Seriously.</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>No server storage</li>
            <li>No analytics</li>
            <li>No tracking</li>
            <li>No cookies</li>
            <li>No accounts</li>
            <li>No logs</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">What Happens to Your Messages</h2>
          <p className="text-gray-300">Your messages are:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Encrypted on your device</li>
            <li>Stored in YOUR browser only</li>
            <li>Never sent to our servers in readable form</li>
            <li>Automatically deleted after expiration</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Local Storage</h2>
          <p className="text-gray-300">We use your browser's localStorage to save:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>Your username preference</li>
            <li>Your retention settings</li>
            <li>Encrypted messages for your rooms</li>
            <li>Legal acceptance flag</li>
          </ul>
          <p className="text-gray-300">This data never leaves your device.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Third Parties</h2>
          <p className="text-gray-300">We don't share anything because we don't have anything to share.</p>
          <p className="text-gray-300">No third-party services are used for analytics, ads, or tracking.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Encryption</h2>
          <p className="text-gray-300">Messages are encrypted using:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>AES-GCM 256-bit encryption</li>
            <li>PBKDF2 key derivation</li>
            <li>Browser's Web Crypto API</li>
          </ul>
          <p className="text-gray-300">Keys are derived from room codes and never stored.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Your Rights</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li><strong>Delete all data:</strong> Clear your browser storage</li>
            <li><strong>Export data:</strong> Use browser dev tools</li>
            <li><strong>Stop service:</strong> Close the tab</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Law Enforcement</h2>
          <p className="text-gray-300">Since we don't store messages, there's nothing to provide. However:</p>
          <ul className="list-disc list-inside space-y-2 text-gray-300 pl-4">
            <li>We cooperate with legal requests</li>
            <li>We may provide technical information</li>
            <li>Active room metadata may be available</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Changes</h2>
          <p className="text-gray-300">If we update this policy, you'll see the date change above.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Contact</h2>
          <p className="text-gray-300">Check the GitHub repo for issues or questions.</p>
        </section>

        <div className="flex justify-center gap-6 text-sm text-gray-600 pt-8 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400">Home</a>
          <a href="/terms" className="hover:text-gray-400">Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
