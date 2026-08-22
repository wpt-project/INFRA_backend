// app/(tabs)/index.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Platform,
  Modal,
  Alert,
  Animated,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

// ─── Constants ──────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0B0F14',
  bg2: '#15171C',
  bg3: '#1C1C1E',
  text: '#F3F3F4',
  textDim: '#9AA0AC',
  accent: '#3FC6B8',
  accentDim: 'rgba(63,198,184,0.12)',
  border: '#2E323C',
  error: '#E5484D',
  success: '#3FC6B8',
  incomingBubble: '#2C2C2E',
  outgoingBubble: '#3FC6B8',
};

const FONTS = {
  heading: 'Lato_700Bold',
  body: 'Lato_400Regular',
  bodyMedium: 'Lato_700Bold',
};

// ─── Sample Data ─────────────────────────────────────────────────────────────

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
    lastMessage: "I'll be there in 10 minutes",
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

// Generate more realistic message history per chat
const getMessagesForChat = (chatName: string) => [
  { id: 'm1', text: `Hi ${chatName}!`, sent: false, time: '10:00 AM' },
  { id: 'm2', text: `Hey there! How's it going?`, sent: true, time: '10:05 AM' },
  { id: 'm3', text: `I'm good, thanks for asking!`, sent: false, time: '10:06 AM' },
  { id: 'm4', text: `Let's catch up soon.`, sent: true, time: '10:10 AM' },
  { id: 'm5', text: `Sure, what time works for you?`, sent: false, time: '10:12 AM' },
  { id: 'm6', text: `How about 4pm?`, sent: true, time: '10:15 AM' },
];

// ─── Sub‑components ──────────────────────────────────────────────────────

// Header
const Header = ({
  onSearchPress,
  onMenuPress,
}: {
  onSearchPress: () => void;
  onMenuPress: () => void;
}) => (
  <View style={styles.header}>
    <Text style={styles.headerTitle}>Chats</Text>
    <View style={styles.headerRight}>
      <TouchableOpacity style={styles.headerIcon} onPress={onSearchPress} hitSlop={8}>
        <Ionicons name="search-outline" size={24} color={COLORS.text} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.headerIcon} onPress={onMenuPress} hitSlop={8}>
        <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
      </TouchableOpacity>
    </View>
  </View>
);

// Chat Item
const ChatItem = ({
  item,
  onPress,
}: {
  item: typeof CHATS[0];
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.chatItem} activeOpacity={0.7} onPress={onPress}>
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

// Empty State
const EmptyState = ({ onNewChat }: { onNewChat: () => void }) => (
  <View style={styles.emptyContainer}>
    <View style={styles.emptyIconContainer}>
      <Ionicons name="chatbubbles-outline" size={56} color={COLORS.textDim} />
    </View>
    <Text style={styles.emptyTitle}>No messages yet</Text>
    <Text style={styles.emptySubtitle}>
      Start a conversation by finding someone to chat with
    </Text>
    <TouchableOpacity style={styles.emptyButton} onPress={onNewChat}>
      <Text style={styles.emptyButtonText}>New Conversation</Text>
    </TouchableOpacity>
  </View>
);

// ─── Chat View (with keyboard‑friendly input) ─────────────────────────────

const ChatView = ({
  chat,
  onBack,
}: {
  chat: typeof CHATS[0];
  onBack: () => void;
}) => {
  const [messages, setMessages] = useState(getMessagesForChat(chat.name));
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const keyboardHeight = useKeyboardHeight();

  // Scroll to bottom on new message or keyboard open
  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', scrollToBottom);
    return () => keyboardDidShow.remove();
  }, []);

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const newMsg = {
      id: `m${Date.now()}`,
      text: inputText.trim(),
      sent: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText('');

    // Simulate "typing" indicator
    setIsTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      setIsTyping(false);
      const replies = [
        "That's great!",
        'Got it, thanks!',
        'Sounds good to me.',
        'I agree.',
        'Let me think about that.',
        'Sure, no problem.',
        "I'll get back to you.",
        'Awesome!',
      ];
      const reply = {
        id: `m${Date.now() + 1}`,
        text: replies[Math.floor(Math.random() * replies.length)],
        sent: false,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, reply]);
    }, 1000 + Math.random() * 1500);
  };

  const renderMessage = ({ item }: { item: typeof messages[0] }) => (
    <View
      style={[
        styles.messageRow,
        item.sent ? styles.messageRowSent : styles.messageRowReceived,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          item.sent ? styles.sentBubble : styles.receivedBubble,
        ]}
      >
        <Text style={styles.messageText}>{item.text}</Text>
        <Text style={styles.messageTime}>{item.time}</Text>
      </View>
    </View>
  );

  const renderTypingIndicator = () => (
    <View style={styles.typingContainer}>
      <View style={[styles.messageBubble, styles.receivedBubble]}>
        <View style={styles.typingDots}>
          <View style={[styles.typingDot, styles.typingDot1]} />
          <View style={[styles.typingDot, styles.typingDot2]} />
          <View style={[styles.typingDot, styles.typingDot3]} />
        </View>
      </View>
    </View>
  );

  // Dynamic bottom padding for input bar
  const inputBarPaddingBottom = keyboardHeight > 0 ? keyboardHeight + 12 : 12;

  return (
    <View style={styles.chatView}>
      {/* Header */}
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.chatHeaderInfo}>
          <Text style={styles.chatHeaderName}>{chat.name}</Text>
          <Text style={styles.chatHeaderStatus}>
            {chat.online ? 'Online' : 'Offline'}
          </Text>
        </View>
        <TouchableOpacity style={styles.chatHeaderIcon}>
          <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Messages + Input */}
      <View style={styles.chatBody}>
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={[
            styles.messagesList,
            // Add bottom padding to keep messages above input
            { paddingBottom: 80 + keyboardHeight },
          ]}
          ListFooterComponent={isTyping ? renderTypingIndicator : null}
          showsVerticalScrollIndicator={false}
        />

        {/* Input bar – stays above keyboard with dynamic padding */}
        <View style={[styles.inputBar, { paddingBottom: inputBarPaddingBottom }]}>
          <TouchableOpacity style={styles.attachButton}>
            <Ionicons name="attach" size={24} color={COLORS.textDim} />
          </TouchableOpacity>
          <TextInput
            style={styles.inputField}
            placeholder="Type a message..."
            placeholderTextColor={COLORS.textDim}
            value={inputText}
            onChangeText={setInputText}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Ionicons name="send" size={20} color={COLORS.bg} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function ChatListScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedChat, setSelectedChat] = useState<typeof CHATS[0] | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const filteredChats = CHATS.filter((chat) =>
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (showSearch) setSearchQuery('');
  };

  const handleChatPress = (chat: typeof CHATS[0]) => setSelectedChat(chat);
  const handleBackFromChat = () => setSelectedChat(null);

  const handleMenuPress = () => setShowMenu(true);
  const handleMenuOption = (option: string) => {
    setShowMenu(false);
    Alert.alert(option, `You selected "${option}"`);
  };

  const handleNewChat = () => {
    Alert.alert('New Conversation', 'This would open a contact picker.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.content}>
        <Header onSearchPress={toggleSearch} onMenuPress={handleMenuPress} />

        {showSearch && (
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Ionicons name="search" size={20} color={COLORS.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search chats..."
                placeholderTextColor={COLORS.textDim}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="done"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color={COLORS.textDim} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {filteredChats.length > 0 ? (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ChatItem item={item} onPress={() => handleChatPress(item)} />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <EmptyState onNewChat={handleNewChat} />
        )}
      </View>

      {/* Chat overlay */}
      {selectedChat && (
        <View style={StyleSheet.absoluteFillObject}>
          <ChatView chat={selectedChat} onBack={handleBackFromChat} />
        </View>
      )}

      {/* Menu Modal */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('New Group')}
            >
              <Ionicons name="people-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuText}>New Group</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('Settings')}
            >
              <Ionicons name="settings-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuText}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => handleMenuOption('Logout')}
            >
              <Ionicons name="log-out-outline" size={22} color={COLORS.error} />
              <Text style={[styles.menuText, styles.menuTextDanger]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
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
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.heading,
    color: COLORS.text,
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
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: COLORS.text,
    fontSize: 15,
    fontFamily: FONTS.body,
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
    backgroundColor: COLORS.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.bg,
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
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  chatTime: {
    fontSize: 11,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
  },
  chatBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMessage: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
    marginRight: 12,
  },
  unreadBadge: {
    backgroundColor: COLORS.accent,
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
    color: COLORS.bg,
    fontFamily: FONTS.bodyMedium,
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
    backgroundColor: COLORS.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    fontFamily: FONTS.heading,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textDim,
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: FONTS.body,
  },
  emptyButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.bodyMedium,
  },

  // ─── Chat View Styles ─────────────────────────────────────────────
  chatView: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.bg2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'ios' ? 8 : 12,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  chatHeaderStatus: {
    fontSize: 13,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
  },
  chatHeaderIcon: {
    padding: 4,
  },
  chatBody: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageRow: {
    marginBottom: 12,
  },
  messageRowSent: {
    alignItems: 'flex-end',
  },
  messageRowReceived: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  sentBubble: {
    backgroundColor: COLORS.outgoingBubble,
    borderBottomRightRadius: 4,
  },
  receivedBubble: {
    backgroundColor: COLORS.incomingBubble,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    color: COLORS.text,
    fontFamily: FONTS.body,
  },
  messageTime: {
    fontSize: 10,
    color: COLORS.textDim,
    marginTop: 4,
    alignSelf: 'flex-end',
    fontFamily: FONTS.body,
  },
  typingContainer: {
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textDim,
    opacity: 0.4,
  },
  typingDot1: {
    opacity: 0.8,
  },
  typingDot2: {
    opacity: 0.5,
  },
  typingDot3: {
    opacity: 0.3,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: COLORS.bg2,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: 12, // will be overwritten by dynamic padding
  },
  attachButton: {
    marginRight: 12,
  },
  inputField: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: COLORS.text,
    fontSize: 16,
    fontFamily: FONTS.body,
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: 12,
    backgroundColor: COLORS.accent,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Menu
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 80 : 60,
    alignItems: 'flex-end',
    paddingRight: 20,
  },
  menuContainer: {
    backgroundColor: COLORS.bg2,
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 180,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 12,
    fontFamily: FONTS.body,
  },
  menuTextDanger: {
    color: COLORS.error,
  },
});