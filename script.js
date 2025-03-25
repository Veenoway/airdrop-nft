const { ethers } = require("ethers");
const fs = require("fs");

const RPC_URL = "https://testnet-rpc.monad.xyz";
const PRIVATE_KEY = "";
const NFT_CONTRACT_ADDRESS = "0x5A21b0F4a4f9B54e16282b6ed5AD014B3C77186F";
const GAS_LIMIT = 300000;
const GAS_PRICE = ethers.parseUnits("50", "gwei");

const ERC721_ABI = [
  "function transferFrom(address from, address to, uint256 tokenId) external",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
  "function isApprovedForAll(address owner, address operator) external view returns (bool)",
  "function setApprovalForAll(address operator, bool approved) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)", // Fonction ERC721Enumerable
];

async function sendNFTsToMultipleAddresses() {
  try {
    // Lire les adresses de destination depuis le fichier CSV
    const addressesData = fs.readFileSync("adresses.txt", "utf8");
    const addresses = addressesData
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));

    console.log(`Nombre d'adresses à traiter: ${addresses.length}`);

    // Connexion au RPC et initialisation du wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    console.log(`Utilisation du wallet: ${wallet.address}`);

    // Initialisation du contrat NFT
    const nftContract = new ethers.Contract(
      NFT_CONTRACT_ADDRESS,
      ERC721_ABI,
      wallet
    );

    // Vérification de l'approbation
    const isApproved = await nftContract.isApprovedForAll(
      wallet.address,
      wallet.address
    );
    if (!isApproved) {
      console.log("Approbation du contrat pour les transferts...");
      const approveTx = await nftContract.setApprovalForAll(
        NFT_CONTRACT_ADDRESS,
        true
      );
      await approveTx.wait();
      console.log("Contrat approuvé avec succès");
    }

    // Vérification du solde NFT
    let balance;
    try {
      balance = await nftContract.balanceOf(wallet.address);
      console.log(`Solde NFT dans le wallet: ${balance.toString()} NFTs`);
    } catch (error) {
      console.error(
        "Erreur lors de la récupération du solde NFT. Le contrat n'implémente peut-être pas ERC721Enumerable."
      );
      console.log("Tentative alternative de récupération des NFTs...");
    }

    // Si le solde est inférieur au nombre d'adresses
    if (balance && Number(balance) < addresses.length) {
      console.warn(
        `Attention: Vous avez seulement ${balance.toString()} NFTs, mais il y a ${
          addresses.length
        } adresses à traiter.`
      );
    }

    // Variables pour stocker les résultats
    let successCount = 0;
    let failCount = 0;
    let currentTokenIndex = 0;

    // Tableau pour stocker les tokenIds utilisables
    let availableTokenIds = [];

    // Méthode alternative pour trouver les tokenIds si ERC721Enumerable n'est pas implémenté
    if (!balance) {
      console.log("Recherche de tokens par méthode alternative...");
      // Vous pouvez implémenter ici une méthode alternative pour trouver les tokenIds
      // Par exemple, scanner les événements Transfer passés ou utiliser un range prédéfini

      // Pour cet exemple, nous allons simplement utiliser une liste prédéfinie de tokenIds à tester
      // Vous devriez adapter cette partie selon votre cas d'usage
      const potentialTokenIds = Array.from({ length: 1000 }, (_, i) => i + 1); // Test des tokenIds de 1 à 1000

      for (const tokenId of potentialTokenIds) {
        try {
          const owner = await nftContract.ownerOf(tokenId);
          if (owner.toLowerCase() === wallet.address.toLowerCase()) {
            availableTokenIds.push(tokenId);
            console.log(`Trouvé NFT #${tokenId} possédé par votre wallet`);

            // Arrêter la recherche si nous avons trouvé suffisamment de NFTs
            if (availableTokenIds.length >= addresses.length) {
              break;
            }
          }
        } catch (error) {
          // Ignorer les erreurs (tokenId non existant, etc.)
        }
      }

      console.log(`Nombre total de NFTs trouvés: ${availableTokenIds.length}`);
    }

    // Boucle à travers les adresses pour envoyer les NFTs
    for (let i = 0; i < addresses.length; i++) {
      const toAddress = addresses[i];
      let tokenId;

      try {
        // Déterminer quel tokenId envoyer
        if (availableTokenIds.length > 0) {
          // Utiliser la liste des tokenIds disponibles si nous l'avons déjà établie
          tokenId = availableTokenIds[i];
          if (!tokenId) {
            console.error(
              `Plus de NFTs disponibles pour l'adresse ${toAddress}`
            );
            failCount++;
            continue;
          }
        } else {
          // Sinon, utiliser la fonction tokenOfOwnerByIndex (ERC721Enumerable)
          try {
            tokenId = await nftContract.tokenOfOwnerByIndex(
              wallet.address,
              currentTokenIndex
            );
            currentTokenIndex++;
          } catch (error) {
            console.error(
              `Impossible de récupérer le token à l'index ${currentTokenIndex}. Erreur:`,
              error.message
            );
            failCount++;
            continue;
          }
        }

        console.log(
          `[${i + 1}/${
            addresses.length
          }] Transfert du NFT #${tokenId} vers ${toAddress}...`
        );

        // Vérifier la propriété du NFT
        const owner = await nftContract.ownerOf(tokenId);
        if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
          console.error(
            `Vous n'êtes pas le propriétaire du NFT #${tokenId}. Propriétaire actuel: ${owner}`
          );
          failCount++;
          continue;
        }

        // Exécuter le transfert
        const tx = await nftContract.transferFrom(
          wallet.address,
          toAddress,
          tokenId,
          { gasLimit: GAS_LIMIT, gasPrice: GAS_PRICE }
        );

        // Attendre la confirmation
        const receipt = await tx.wait();
        console.log(`Transaction confirmée! Hash: ${receipt.transactionHash}`);
        successCount++;

        // Pause entre les transactions
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(
          `Erreur lors du transfert vers ${toAddress}: ${err.message}`
        );
        failCount++;
      }
    }

    // Afficher le résumé
    console.log(`\nRésumé des transferts:`);
    console.log(`- Réussis: ${successCount}`);
    console.log(`- Échoués: ${failCount}`);
    console.log(
      `- Total traité: ${successCount + failCount}/${addresses.length}`
    );
  } catch (error) {
    console.error("Erreur lors de l'exécution du script:", error);
  }
}

sendNFTsToMultipleAddresses();
