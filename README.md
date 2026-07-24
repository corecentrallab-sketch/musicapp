# NoteSnap

**NoteSnap** is a cross-platform mobile app that identifies copyright-free classical and public-domain music playing around you — like Shazam for sheet music. It provides piano sheet music and guitar tablature alongside album cover art, plus a built-in notation editor and practice tools.

Built with **Expo (React Native)** and **TypeScript**.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI (`npx expo`)

### Setup

```bash
# Clone the repo
git clone https://github.com/corecentrallab-sketch/musicapp.git
cd musicapp

# Install dependencies
npm install

# Start the Expo dev server
npx expo start
```

Then scan the QR code with **Expo Go** (iOS/Android) or press `i` for iOS Simulator / `a` for Android Emulator.

### Project Structure

```
src/
├── screens/          # Screen components (Home, History, Editor, Settings)
├── components/       # Reusable UI components
├── navigation/       # React Navigation setup (TabNavigator)
├── services/         # API clients, audio recognition, cloud sync
├── hooks/            # Custom React hooks
└── types/            # TypeScript type definitions
```

### Tech Stack
- **Expo** (managed workflow) — cross-platform iOS/Android
- **React Navigation** — tab-based navigation
- **TypeScript** — type safety
- **Ionicons** — tab bar icons

## Features (Planned)
- 🎵 **Music Recognition** — identify public-domain classical pieces
- 📚 **History** — saved pieces, alphabetically organised
- ✏️ **Notation Editor** — correct and transpose sheet music
- ⚙️ **Settings** — account and subscription management
