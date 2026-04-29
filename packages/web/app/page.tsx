export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <h1 className="text-6xl font-bold text-white mb-4">Linkora Social</h1>
          <p className="text-xl text-gray-300 mb-8">SocialFi on Stellar Blockchain</p>
          <a
            href="/feed"
            className="inline-block bg-white text-purple-900 font-semibold px-8 py-3 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Go to Feed
          </a>
        </div>
      </div>
    </main>
  )
}
