import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Sparkles, Shield, Clock, AlertCircle } from 'lucide-react';

export default function GuidePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <Navbar />

      <main className="flex-1 py-16">
        <div className="flow-container">
          <div className="mb-12 text-center">
            <h1 className="text-[clamp(28px,4vw,40px)] font-semibold tracking-[-0.035em] text-[var(--ink)]">
              Credit pricing & operations guide
            </h1>
            <p className="mt-3 text-sm text-[var(--ink2)]">
              Model credit rates, queue reservation mechanics, and retention policies.
            </p>
          </div>

          {/* Alert box */}
          <div className="mb-8 flex items-start gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--a1soft)] p-4 text-xs text-[var(--ink)] sm:text-sm">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--a1)]" />
            <div>
              <span className="font-semibold">One-time welcome grant:</span> Eligible free users receive{' '}
              <strong>30 Standard + 20 Pro credits</strong> once on registration.
            </div>
          </div>

          {/* Model Pricing Tables */}
          <div className="space-y-8 mb-12">
            {/* Standard credits */}
            <div className="glass-panel p-6 rounded-2xl border-white/10">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-indigo-500" />
                Standard Credits Catalog
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                These models consume credits from your Standard Wallet balance.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Model / Option</th>
                      <th className="py-2.5 px-3">Media</th>
                      <th className="py-2.5 px-3">Cost per request</th>
                      <th className="py-2.5 px-3">Typical Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-200">
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Veo 3.1 Lite — Low Priority</td>
                      <td className="py-3 px-3">Video</td>
                      <td className="py-3 px-3 font-bold text-indigo-300">10 Standard</td>
                      <td className="py-3 px-3 text-slate-400">720p / 1080p, 4-8s</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Nano Banana 2</td>
                      <td className="py-3 px-3">Image</td>
                      <td className="py-3 px-3 font-bold text-indigo-300">3 Standard</td>
                      <td className="py-3 px-3 text-slate-400">High-definition 1K/2K</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Nano Banana Lite</td>
                      <td className="py-3 px-3">Image</td>
                      <td className="py-3 px-3 font-bold text-indigo-300">2 Standard</td>
                      <td className="py-3 px-3 text-slate-400">Quick concept draft</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Nano Banana Pro</td>
                      <td className="py-3 px-3">Image</td>
                      <td className="py-3 px-3 font-bold text-indigo-300">5 Standard</td>
                      <td className="py-3 px-3 text-slate-400">Ultra-fidelity details</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pro credits */}
            <div className="glass-panel p-6 rounded-2xl border-white/10">
              <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-purple-500" />
                Pro Credits Catalog
              </h2>
              <p className="text-xs text-slate-400 mb-4">
                These models consume credits from your Pro Wallet balance.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Model / Option</th>
                      <th className="py-2.5 px-3">Media</th>
                      <th className="py-2.5 px-3">Cost per request</th>
                      <th className="py-2.5 px-3">Typical Output</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-200">
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Veo 3.1 Lite</td>
                      <td className="py-3 px-3">Video</td>
                      <td className="py-3 px-3 font-bold text-purple-300">15 Pro</td>
                      <td className="py-3 px-3 text-slate-400">Priority standard queue</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Omni Flash</td>
                      <td className="py-3 px-3">Video</td>
                      <td className="py-3 px-3 font-bold text-purple-300">20 Pro</td>
                      <td className="py-3 px-3 text-slate-400">Omni-reference video</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Veo 3.1 Fast</td>
                      <td className="py-3 px-3">Video</td>
                      <td className="py-3 px-3 font-bold text-purple-300">40 Pro</td>
                      <td className="py-3 px-3 text-slate-400">Accelerated high-res video</td>
                    </tr>
                    <tr>
                      <td className="py-3 px-3 font-semibold text-white">Veo 3.1 Quality</td>
                      <td className="py-3 px-3">Video</td>
                      <td className="py-3 px-3 font-bold text-purple-300">150 Pro</td>
                      <td className="py-3 px-3 text-slate-400">Ultra-cinematic photorealism</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Retention and Queuing Policy */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-panel p-5 rounded-2xl border-white/10">
              <div className="flex items-center gap-2 font-bold text-white text-sm mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                24-Hour Automated Retention
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                All temporary generation records, prompts, uploaded references, and generated video/image files are retained in our private storage for exactly 24 hours. Once 24 hours pass, files are permanently deleted. Please download completed generations to your computer promptly.
              </p>
            </div>

            <div className="glass-panel p-5 rounded-2xl border-white/10">
              <div className="flex items-center gap-2 font-bold text-white text-sm mb-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Zero-Lost Credits Guarantee
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                When a generation request enters the queue, credits are reserved. They are only permanently committed once your output media is delivered. If a job fails or you cancel while In Queue, the reservation is immediately released.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
