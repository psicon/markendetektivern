import algoliasearch from 'algoliasearch';

const client = algoliasearch('Y0KKZHT49Q', 'b87bb9ffcda4b4b3e3161e155e29869e');

async function testAlgolia() {
  try {
    console.log('🔍 Testing Algolia connection...');
    
    // List all indices
    const { items: indices } = await client.listIndices();
    console.log('📋 Available indices:', indices.map(i => i.name));
    
    // Test search on each index
    for (const index of indices) {
      try {
        const searchIndex = client.initIndex(index.name);
        const result = await searchIndex.search('test', { hitsPerPage: 1 });
        console.log(`✅ Index "${index.name}": ${result.nbHits} total hits`);
      } catch (error) {
        console.log(`❌ Index "${index.name}": Error -`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Algolia error:', error.message);
  }
}

testAlgolia();
