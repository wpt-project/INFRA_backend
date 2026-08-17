// app/(tabs)/index.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView as SafeAreaViewContext } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const C = {
  bg: '#0B0F14',
  bg2: '#15171C',
  bg3: '#1A1D24',
  ink: '#3FC6B8',
  inkDim: '#9AA0AC',
  accent: '#3FC6B8',
  ring: 'rgba(63,198,184,0.445)',
  ringSoft: 'rgba(63,198,184,0.12)',
  borderSoft: '#2E323C',
  text: '#F3F3F4',
  fail: '#E5484D',
  success: '#6bcf7f',
};

// Sample chat data
const CHATS = [
  {
    id: '1',
    name: 'Jenslin',
    lastMessage: 'Hey! How are you doing?',
    time: '12:30 PM',
    unread: 2,
    online: true,
    avatar: null,
    initials: 'AJ',
  },
  {
    id: '2',
    name: 'Mervin',
    lastMessage: 'See you tomorrow at 3pm',
    time: '11:15 AM',
    unread: 0,
    online: false,
    avatar: null,
    initials: 'BS',
  },
  {
    id: '3',
    name: 'Praven',
    lastMessage: 'Can you send me the files?',
    time: 'Yesterday',
    unread: 5,
    online: true,
    avatar: null,
    initials: 'CW',
  },
  {
    id: '4',
    name: 'Rajesh',
    lastMessage: 'Thanks for your help!',
    time: 'Yesterday',
    unread: 0,
    online: false,
    avatar: null,
    initials: 'DB',
  },
  {
    id: '5',
    name: 'Sathish',
    lastMessage: 'I\'ll be there in 10 minutes',
    time: '2 days ago',
    unread: 0,
    online: true,
    avatar: null,
    initials: 'EM',
  },
  {
    id: '6',
    name: 'Krisha',
    lastMessage: 'Great meeting you today',
    time: '3 days ago',
    unread: 1,
    online: false,
    avatar: null,
    initials: 'FW',
  },
];

// Header Component
const Header = () => {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>Chats</Text>
      </View>
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.headerIcon} hitSlop={8}>
          <Ionicons name="search-outline" size={24} color={C.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerIcon} hitSlop={8}>
          <Ionicons name="ellipsis-vertical" size={24} color={C.ink} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Chat Item Component
const ChatItem = ({ item }: { item: typeof CHATS[0] }) => {
  return (
    <TouchableOpacity style={styles.chatItem} activeOpacity={0.7}>
      <View style={styles.avatarContainer}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{item.initials}</Text>
          </View>
        )}
        {item.online && <View style={styles.onlineDot} />}
      </View>
      
      <View style={styles.chatInfo}>
        <View style={styles.chatTop}>
          <Text style={styles.chatName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.chatTime}>{item.time}</Text>
        </View>
        <View style={styles.chatBottom}>
          <Text style={styles.chatMessage} numberOfLines={1}>
            {item.lastMessage}
          </Text>
          {item.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

// Empty State Component
const EmptyState = () => {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="chatbubbles-outline" size={56} color={C.inkDim} />
      </View>
      <Text style={styles.emptyTitle}>No messages yet</Text>
      <Text style={styles.emptySubtitle}>
        Start a conversation by finding someone to chat with
      </Text>
      <TouchableOpacity style={styles.emptyButton}>
        <Text style={styles.emptyButtonText}>New Conversation</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function ChatListScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const filteredChats = CHATS.filter(chat =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaViewContext style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <LinearGradient
        colors={[C.bg2, C.bg]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />
      
      <View style={styles.content}>
        {/* Header */}
        <Header />

        {/* Search Bar */}
        {showSearch && (
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Ionicons name="search" size={20} color={C.inkDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search chats..."
                placeholderTextColor={C.inkDim}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="done"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color={C.inkDim} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Chat List */}
        {filteredChats.length > 0 ? (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ChatItem item={item} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <EmptyState />
        )}
      </View>
    </SafeAreaViewContext>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 8 : 12,
    paddingBottom: 16,
    backgroundColor: C.bg2,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: C.text,
    fontFamily: 'Fraunces-Black',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIcon: {
    padding: 4,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: C.bg2,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: C.text,
    fontSize: 15,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 20,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.bg3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: C.ink,
    fontFamily: 'Fraunces-Black',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.success,
    borderWidth: 2,
    borderColor: C.bg2,
  },
  chatInfo: {
    flex: 1,
  },
  chatTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    fontFamily: 'SpaceGrotesk-Medium',
  },
  chatTime: {
    fontSize: 11,
    color: C.inkDim,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  chatBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMessage: {
    flex: 1,
    fontSize: 14,
    color: C.inkDim,
    fontFamily: 'SpaceGrotesk-Regular',
    marginRight: 12,
  },
  unreadBadge: {
    backgroundColor: C.ink,
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  unreadText: {
    fontSize: 12,
    fontWeight: '600',
    color: C.bg,
    fontFamily: 'SpaceGrotesk-Medium',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.bg3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    fontFamily: 'Fraunces-Black',
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.inkDim,
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: 'SpaceGrotesk-Regular',
  },
  emptyButton: {
    backgroundColor: C.ink,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: C.bg,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceGrotesk-Medium',
  },
});
