# duc-engine

CLI API pour créer des polls Twitch avec gestion des questions depuis un fichier JSON.

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
PORT=3000
```

## 📋 Configuration Twitch

1. Allez sur [Twitch Developers](https://dev.twitch.tv/console/apps)
2. Créez une nouvelle application
3. Récupérez votre `Client ID` et `Client Secret`
4. Ajoutez `http://localhost:3000/auth/callback` comme URL de redirection

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

### Gestion des questions

```bash
# Afficher le statut des questions
npm run questions -- --status

# Lister toutes les questions
npm run questions -- --list

# Ajouter une nouvelle question
npm run questions -- --add

# Réinitialiser toutes les questions
npm run questions -- --reset
```

### Création de polls

```bash
# Créer un poll avec une question aléatoire (comportement par défaut)
npm run poll

# Créer un poll avec une durée personnalisée
npm run poll -- --duration 120

# Terminer un poll existant
npm run poll -- --end
```

### Gestion des polls

```bash
# Lister les polls actifs
npm start polls --list

# Terminer un poll
npm start polls --end <poll_id>
```

## 📁 Structure du fichier questions.json

```json
{
  "poll": [
    {
      "question": "Quelle est la capitale de la France?",
      "status": true,
      "answers": [
        "Paris",
        "Lyon",
        "Marseille",
        "Bordeaux"
      ]
    }
  ]
}
```

- `question` : Le texte de la question
- `status` : `true` si la question est disponible, `false` si elle a été utilisée
- `answers` : Tableau des réponses possibles (2 à 5 réponses)

## 🔧 Fonctionnalités

- ✅ Authentification OAuth2 avec Twitch et persistance des tokens
- ✅ Gestion automatique des questions (marquage comme utilisées)
- ✅ Création de polls avec validation
- ✅ Interface CLI intuitive
- ✅ Gestion des erreurs et validation
- ✅ Sélection automatique de questions aléatoires
- ✅ Durée personnalisable des polls
- ✅ Réinitialisation des questions via CLI

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
- Vérifiez que le port 3000 n'est pas utilisé par une autre application

### Erreur de création de poll
- Vérifiez que vous êtes connecté à Twitch
- Assurez-vous que votre compte a les permissions nécessaires
- Vérifiez que le fichier `questions.json` est valide

## 📄 Licence

MIT
