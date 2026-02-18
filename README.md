# duc-engine

CLI API pour interagir avec Twitch (auth, polls, rewards, commandes de chat, API) — la gestion des questions/sondages via fichiers JSON a été retirée.

## 🚀 Installation

1. Clonez ou téléchargez le projet
2. Installez les dépendances :
```bash
npm install
```

3. Créez un fichier `.env` avec vos identifiants Twitch :
```env
TWITCH_CLIENT_ID=votre_client_id
TWITCH_CLIENT_SECRET=votre_client_secret
PORT=3002
```

## 📋 Configuration Twitch

1. Allez sur [Twitch Developers](https://dev.twitch.tv/console/apps)
2. Créez une nouvelle application
3. Récupérez votre `Client ID` et `Client Secret`
4. Ajoutez `http://localhost:3002/auth/callback` comme URL de redirection

## 🎯 Utilisation

### Authentification

```bash
# Se connecter à Twitch
npm run auth -- --login

# Vérifier le statut de connexion
npm run auth -- --status

# Se déconnecter
npm run auth -- --logout
```

> Note : la gestion historique des questions/sondages via `questions.json` / `sondage.json` a été supprimée. Les commandes et endpoints associés ne sont plus disponibles.

## 🔧 Fonctionnalités

- ✅ Authentification OAuth2 avec Twitch et persistance des tokens
- ✅ Gestion des rewards de points de chaîne
- ✅ Commandes de bot de chat configurables via `files/commands.json`
- ✅ Interface CLI intuitive
- ✅ Gestion des erreurs et validation

## 📝 Scopes Twitch requis

- `channel:manage:polls` - Gérer les polls du canal
- `channel:read:polls` - Lire les polls du canal
- `channel:read:redemptions` - Lire les rewards de points du canal
- `channel:manage:redemptions` - Gérer les rewards de points du canal
- `user:read:email` - Lire l'email de l'utilisateur

## 🐛 Dépannage

### Erreur d'authentification
- Vérifiez que votre `Client ID` et `Client Secret` sont corrects
- Assurez-vous que l'URL de redirection est bien configurée
- Vérifiez que le port 3002 n'est pas utilisé par une autre application

### Erreur de création de poll
- Vérifiez que vous êtes connecté à Twitch
- Assurez-vous que votre compte a les permissions nécessaires

## 📄 Licence

MIT
